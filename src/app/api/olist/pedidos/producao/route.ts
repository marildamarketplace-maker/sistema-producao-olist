import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { resolverContaPedidoManual } from "@/lib/pedido-manual-acesso";
import { pedidoProducaoSchema } from "@/lib/pedido-producao-contrato";
import { carregarOrigemPedidoProducao, montarSnapshotPedidoProducao } from "@/lib/pedido-producao-origem";
import { consultarCadastrosFilaOlist, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { obterReferenciaPedidoManual, resolverCorrespondenciaPedidoManual } from "@/lib/pedido-manual-correspondencia";
import { resolverDirecionamentoPedido, validarVersaoDirecionamento, ErroDirecionamentoPedidos } from "@/lib/direcionamento-pedidos";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { bloquearFornecedorPedidoManual, capturarFornecedorPedidoManual, validarFornecedorPedidoManual } from "@/lib/pedido-manual-fornecedor";
import { listarReferenciasProducao } from "@/lib/pedido-producao-disponibilidade";
import { assinarConsultaProducao, lerConsultaProducao, ErroContextoConsultaProducao } from "@/lib/pedido-producao-contexto";
import { capturarVendedorFila } from "@/lib/vendedor-fila-producao";

const resposta = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
const comprovanteSelect = { id: true, status: true, createdAt: true, autorId: true, hashEntrada: true,
  chaveIdempotencia: true, aplicativoFilial: { select: { id: true, nome: true } } } as const;
function comprovante(p: { id: string; status: string; createdAt: Date; aplicativoFilial: { id: string; nome: string } | null }) {
  return { id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), aplicativo: p.aplicativoFilial, filaExterna: true };
}
function falha(error: unknown) {
  if (error instanceof ErroContextoConsultaProducao) return resposta({ error: error.message, codigo: "CONTEXTO_CONSULTA_EXPIRADO" }, 409);
  if (error instanceof ErroFilaOlist || error instanceof ErroAutorizacaoOlist || error instanceof ErroDirecionamentoPedidos) return resposta({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return resposta({ error: "Revise vendedor, cliente, itens e dados comerciais." }, 400);
  return resposta({ error: "Não foi possível concluir a operação. Confira a integração e tente novamente." }, 502);
}
async function autorizar(request: Request) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroFilaOlist("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: {
    id: true, ativo: true, aplicativoId: true, podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: true,
  } });
  if (!usuario?.ativo || !usuario.podeSolicitarProducao) throw new ErroFilaOlist("Sem permissão para enviar solicitações.", 403);
  const params = new URL(request.url).searchParams;
  const solicitacaoId = z.guid().parse(params.get("solicitacaoId"));
  // Comprovantes permanecem consultáveis quando a produção avança de estado.
  const solicitacao = await prisma.solicitacaoProducao.findFirst({ where: { id: solicitacaoId, aplicativoId: usuario.aplicativoId }, select: { id: true, status: true } });
  if (!solicitacao) throw new ErroFilaOlist("Solicitação não encontrada neste aplicativo.", 404);
  return { usuario, solicitacao, params, solicitacaoId };
}
type Usuario = Awaited<ReturnType<typeof autorizar>>["usuario"];
async function contaFornecedor(usuario: Usuario, aplicativoId: string) {
  const contexto = await resolverContaPedidoManual(usuario, aplicativoId);
  if (!contexto.fornecedor) throw new ErroFilaOlist("Selecione uma conta de fornecedor autorizado.", 403);
  return contexto;
}
const referencias = listarReferenciasProducao;
async function contaReferencia(usuario: Usuario, aplicativoId: string) {
  if (!usuario.podeSelecionarFilialFornecedor && !(await referencias(usuario)).some(a => a.id === aplicativoId)) {
    throw new ErroFilaOlist("Use a referência do fornecedor definida pelo sistema.", 403);
  }
  return contaFornecedor(usuario, aplicativoId);
}
const idsResolucaoSchema = z.object({ vendedorOrigemId: z.coerce.number().int().positive(), clienteOrigemId: z.coerce.number().int().positive(), aplicativoOrigemId: z.guid() });
function idsResolucao(params: URLSearchParams) {
  return idsResolucaoSchema.parse({ vendedorOrigemId: params.get("vendedorOrigemId"), clienteOrigemId: params.get("clienteOrigemId"), aplicativoOrigemId: params.get("aplicativoOrigemId") });
}
function exigirEmProducao(status: string) {
  if (status !== "em_producao") throw new ErroFilaOlist("A solicitação não está mais em produção. Confira o pedido existente.", 409);
}
async function resolver(usuario: Usuario, ids: { aplicativoOrigemId: string; vendedorOrigemId: number; clienteOrigemId: number }) {
  const contexto = await contaReferencia(usuario, ids.aplicativoOrigemId);
  const referencia = await obterReferenciaPedidoManual(usuario, ids);
  const { nome, cpfCnpj, uf } = referencia.cliente;
  const decisao = await resolverDirecionamentoPedido(contexto.fornecedor!.matrizId, { nome, cpfCnpj, uf });
  const destino = await contaFornecedor(usuario, decisao.aplicativoId);
  if (contexto.fornecedor!.matrizId !== destino.fornecedor!.matrizId) throw new ErroFilaOlist("O direcionamento deve permanecer no fornecedor autorizado.", 403);
  const selecoes = await resolverCorrespondenciaPedidoManual(usuario, referencia, decisao.aplicativoId, { validarDadosDirecionamento: true });
  const fornecedorManual = await capturarFornecedorPedidoManual(usuario, referencia.aplicativoId, decisao.aplicativoId);
  return { referencia, decisao, aplicativoDestino: destino.conta, fornecedorManual,
    selecoes: { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId, vendedorFixo: selecoes.vendedorFixo } };
}
/** Revalida no banco o acesso atual; o comprovante assinado evita HTTP de identidade por página. */
async function autorizarContextoConsulta(usuario: Usuario, solicitacaoId: string, destinoId: string, params: URLSearchParams, token: string) {
  const contexto = lerConsultaProducao(token);
  const ids = idsResolucao(params);
  if (contexto.usuarioId !== usuario.id || contexto.aplicativoSolicitanteId !== usuario.aplicativoId || contexto.solicitacaoId !== solicitacaoId ||
    contexto.referenciaId !== ids.aplicativoOrigemId || contexto.vendedorOrigemId !== ids.vendedorOrigemId || contexto.clienteOrigemId !== ids.clienteOrigemId ||
    contexto.destinoId !== destinoId || contexto.vinculosVersao !== usuario.vinculosOlistVersao || contexto.podeSelecionarFilial !== usuario.podeSelecionarFilialFornecedor) {
    throw new ErroContextoConsultaProducao();
  }
  const origem = await contaReferencia(usuario, contexto.referenciaId);
  const destino = contexto.referenciaId === destinoId ? origem : await contaFornecedor(usuario, destinoId);
  if (origem.fornecedor!.matrizId !== contexto.matrizId || destino.fornecedor!.matrizId !== contexto.matrizId ||
    origem.vendedorId !== contexto.vendedorOrigemId || destino.vendedorId !== contexto.vendedorDestinoId) throw new ErroContextoConsultaProducao();
  if (contexto.regraTipo === "CONTA_UNICA") {
    if (destinoId !== contexto.matrizId || await prisma.aplicativo.findFirst({ where: { aplicativoPaiId: contexto.matrizId }, select: { id: true } })) throw new ErroContextoConsultaProducao();
  } else {
    const config = await prisma.direcionamentoPedidos.findUnique({ where: { aplicativoPaiId: contexto.matrizId }, select: { versao: true } });
    if (config?.versao !== contexto.regraVersao) throw new ErroContextoConsultaProducao();
  }
  return destino;
}
export async function GET(request: Request) {
  try {
    const { usuario, params, solicitacaoId, solicitacao } = await autorizar(request);
    const pedidoId = params.get("pedidoId");
    if (pedidoId) {
      const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where: {
        id: z.guid().parse(pedidoId), solicitacaoProducaoId: solicitacaoId, aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id,
      }, select: comprovanteSelect });
      if (!pedido) throw new ErroFilaOlist("Comprovante não encontrado.", 404);
      return resposta(comprovante(pedido));
    }
    exigirEmProducao(solicitacao.status);
    if (params.get("acao") === "resolver") {
      const ids = idsResolucao(params);
      const resolucao = await resolver(usuario, ids);
      const contextoConsulta = assinarConsultaProducao({
        usuarioId: usuario.id, aplicativoSolicitanteId: usuario.aplicativoId, solicitacaoId,
        referenciaId: ids.aplicativoOrigemId, vendedorOrigemId: ids.vendedorOrigemId, clienteOrigemId: ids.clienteOrigemId,
        destinoId: resolucao.decisao.aplicativoId, matrizId: resolucao.fornecedorManual.matrizId,
        vendedorDestinoId: resolucao.selecoes.vendedorId, vinculosVersao: usuario.vinculosOlistVersao,
        podeSelecionarFilial: usuario.podeSelecionarFilialFornecedor,
        regraTipo: resolucao.decisao.tipo, regraVersao: resolucao.decisao.versao,
      });
      return resposta({ ...resolucao, contextoConsulta });
    }
    if (!params.has("aplicativoId")) {
      const aplicativos = await referencias(usuario);
      return resposta({ aplicativos, aplicativoPadraoId: aplicativos.find(a => !a.bloqueio)?.id ?? "" });
    }
    const aplicativoId = params.get("aplicativoId")!;
    const contextoConsulta = params.get("contextoConsulta");
    let contaAutorizada: Awaited<ReturnType<typeof contaFornecedor>> | undefined;
    if (contextoConsulta && params.get("acao") !== "origem") {
      contaAutorizada = await autorizarContextoConsulta(usuario, solicitacaoId, aplicativoId, params, contextoConsulta);
    } else if (!usuario.podeSelecionarFilialFornecedor && !(await referencias(usuario)).some(a => a.id === aplicativoId)) {
      // Pesquisas na conta resultante só são autorizadas após derivar o destino novamente no servidor.
      if (!["aplicativoOrigemId", "vendedorOrigemId", "clienteOrigemId"].every(chave => params.has(chave))) throw new ErroFilaOlist("Aplicativo não autorizado sem direcionamento automático.", 403);
      const calculada = await resolver(usuario, idsResolucao(params));
      if (calculada.decisao.aplicativoId !== aplicativoId) throw new ErroFilaOlist("Aplicativo diferente do direcionamento automático.", 403);
    }
    const contexto = contaAutorizada ?? (params.get("acao") === "origem" ? await contaReferencia(usuario, aplicativoId) : await contaFornecedor(usuario, aplicativoId));
    if (params.get("acao") === "origem") {
      const origem = await carregarOrigemPedidoProducao(usuario.aplicativoId, solicitacaoId, contexto.fornecedor!, contexto.conta.id);
      return resposta({ itens: origem.itens, observacao: origem.observacao, revisao: origem.revisao, revisaoFonte: origem.revisaoFonte });
    }
    if (!params.has("recurso")) return resposta({ conta: contexto.conta, vendedorId: contexto.vendedorId, vendedorFixo: contexto.vendedorId !== null });
    return resposta(await consultarCadastrosFilaOlist(contexto.conta.id, params, { vendedorId: contexto.vendedorId }, request.signal));
  } catch (error) { return falha(error); }
}
type Confirmacao = { usuarioId: string; aplicativoId: string; solicitacaoId: string; chave: string; hash: string };
async function recuperar(c: Confirmacao) {
  const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where: {
    solicitacaoProducaoId: c.solicitacaoId, aplicativoSolicitanteId: c.aplicativoId,
  }, select: comprovanteSelect });
  if (!pedido) return null;
  if (pedido.autorId !== c.usuarioId) throw new ErroFilaOlist("Esta solicitação já está na fila do fornecedor.", 409);
  if (pedido.chaveIdempotencia !== c.chave || pedido.hashEntrada !== c.hash) return resposta({ error: "A solicitação já possui um pedido. As alterações atuais não foram aplicadas.", pedidoExistente: comprovante(pedido) }, 409);
  return resposta(comprovante(pedido));
}
export async function POST(request: Request) {
  let confirmacao: Confirmacao | null = null;
  try {
    const { usuario, solicitacaoId, solicitacao } = await autorizar(request);
    const entrada = pedidoProducaoSchema.parse(await request.json().catch(() => null));
    confirmacao = { usuarioId: usuario.id, aplicativoId: usuario.aplicativoId, solicitacaoId, chave: entrada.chaveIdempotencia,
      hash: createHash("sha256").update(JSON.stringify(entrada)).digest("hex") };
    const existente = await recuperar(confirmacao);
    if (existente) return existente;
    exigirEmProducao(solicitacao.status);
    const resolucao = await resolver(usuario, { aplicativoOrigemId: entrada.origemManual.aplicativoId,
      vendedorOrigemId: entrada.origemManual.vendedor.id, clienteOrigemId: entrada.origemManual.cliente.id });
    if (JSON.stringify(resolucao.referencia) !== JSON.stringify(entrada.origemManual) || JSON.stringify(resolucao.decisao) !== JSON.stringify(entrada.decisaoDirecionamento) ||
      JSON.stringify(resolucao.fornecedorManual) !== JSON.stringify(entrada.fornecedorManual) || resolucao.decisao.aplicativoId !== entrada.aplicativoId ||
      entrada.selecoes.clienteId !== resolucao.selecoes.clienteId || entrada.selecoes.vendedorId !== resolucao.selecoes.vendedorId) {
      throw new ErroFilaOlist("Origem, cadastros ou direcionamento alterados. Revise o pedido.", 409);
    }
    const fornecedor = resolucao.fornecedorManual;
    const resultado = await prisma.$transaction(async tx => {
      await bloquearFornecedorPedidoManual(tx, fornecedor);
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuario.id}::uuid FOR SHARE`;
      const atual = await tx.usuario.findUnique({ where: { id: usuario.id }, select: {
        ativo: true, aplicativoId: true, podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: true,
      } });
      if (!atual?.ativo || !atual.podeSolicitarProducao || atual.aplicativoId !== usuario.aplicativoId) throw new ErroFilaOlist("Permissões alteradas. Atualize a página.", 403);
      if (atual.podeSelecionarFilialFornecedor !== usuario.podeSelecionarFilialFornecedor) throw new ErroFilaOlist("Permissão de filial alterada. Revise o direcionamento.", 409);
      if (atual.vinculosOlistVersao !== usuario.vinculosOlistVersao) throw new ErroFilaOlist("Vínculos do vendedor alterados. Revise o pedido.", 409);
      await validarFornecedorPedidoManual(tx, fornecedor);
      await validarVersaoDirecionamento(tx, fornecedor.matrizId, resolucao.decisao);
      if (!await bloquearDestinoFornecedor(tx, fornecedor.matrizId, entrada.origemManual.aplicativoId) || !await bloquearDestinoFornecedor(tx, fornecedor.matrizId, entrada.aplicativoId)) throw new ErroFilaOlist("Destino alterado. Revise o pedido.", 409);
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id=${solicitacaoId}::uuid AND aplicativo_id=${usuario.aplicativoId}::uuid FOR UPDATE`;
      const [pedidoEnviado, envioAnterior] = await Promise.all([
        tx.pedidoFornecedorSolicitacao.findFirst({ where: { solicitacaoId }, select: { id: true } }),
        tx.envioFornecedor.findUnique({ where: { solicitacaoId }, select: { estado: true, pedidoOlistId: true } }),
      ]);
      if (pedidoEnviado || envioAnterior?.pedidoOlistId || (envioAnterior && !["REJEITADO", "LIBERADO"].includes(envioAnterior.estado))) throw new ErroFilaOlist("Existe envio concluído, em andamento ou incerto. Confira o envio existente.", 409);
      const origem = await carregarOrigemPedidoProducao(usuario.aplicativoId, solicitacaoId, fornecedor, entrada.origemManual.aplicativoId, tx);
      if (origem.revisao !== entrada.revisaoProducao) throw new ErroFilaOlist("A solicitação ou suas associações mudou. Recarregue e revise os dados de produção.", 409);
      const dados = montarSnapshotPedidoProducao(entrada, origem.originais);
      const vendedorOrigem = await capturarVendedorFila({ usuarioId: usuario.id, aplicativoSolicitanteId: usuario.aplicativoId,
        matrizId: fornecedor.matrizId, aplicativoId: entrada.aplicativoId, vendedorOlistId: entrada.selecoes.vendedorId!,
        fonte: "VINCULO", revisaoEsperada: fornecedor.destino.revisao }, tx);
      return tx.pedidoFornecedorQueue.create({ data: {
        aplicativoSolicitanteId: usuario.aplicativoId, solicitacaoProducaoId: solicitacaoId, aplicativoFornecedorId: fornecedor.matrizId,
        fornecedorId: fornecedor.fornecedorId, tipoOrigem: "PRODUCAO", autorId: usuario.id,
        chaveIdempotencia: entrada.chaveIdempotencia, hashEntrada: confirmacao!.hash, vendedorFixo: true,
        aplicativoFilialId: entrada.aplicativoId, direcionadoPorId: usuario.id, direcionadoEm: new Date(),
        dadosPedido: { ...dados, vendedorOrigem } as unknown as Prisma.InputJsonValue, status: "PENDENTE",
      }, select: comprovanteSelect });
    });
    return resposta(comprovante(resultado), 201);
  } catch (error) {
    if (confirmacao) {
      try {
        const atual = await autorizar(request);
        if (atual.usuario.id === confirmacao.usuarioId && atual.usuario.aplicativoId === confirmacao.aplicativoId) {
          const existente = await recuperar(confirmacao); if (existente) return existente;
        }
      } catch (recuperacao) {
        if (recuperacao instanceof ErroFilaOlist && recuperacao.status === 409) return falha(recuperacao);
        // Sem autorização/banco, preservar o erro original e a chave recuperável.
      }
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return resposta({ error: "Esta solicitação ou confirmação já possui um pedido na fila. Confira o envio existente." }, 409);
    return falha(error);
  }
}
