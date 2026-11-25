import { exigirComerciaisCriacao, detalharErrosFilaOlist } from "@/lib/fila-olist-validacao";
import { consultarEstampasPedido } from "@/lib/estampas-pedido";
import { consultarTamanhosPedido, validarMetragensPedido, ErroMetragemPedido } from "@/lib/tamanhos-pedido";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { autorizarPedidoManual, resolverContaPedidoManual, listarReferenciasPedidoManual } from "@/lib/pedido-manual-acesso";
import { pedidoManualSchema, pedidoManualLegadoSchema, montarDadosPedidoManual } from "@/lib/pedido-manual-contrato";
import { consultarCadastrosFilaOlist, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { obterReferenciaPedidoManual, resolverCorrespondenciaPedidoManual } from "@/lib/pedido-manual-correspondencia";
import { resolverDirecionamentoPedido, validarVersaoDirecionamento, ErroDirecionamentoPedidos } from "@/lib/direcionamento-pedidos";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { bloquearFornecedorPedidoManual, capturarFornecedorPedidoManual, validarFornecedorPedidoManual } from "@/lib/pedido-manual-fornecedor";

const resposta = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
const comprovanteSelect = { id: true, status: true, createdAt: true, aplicativoFornecedorId: true, aplicativoSolicitanteId: true, aplicativoFilial: { select: { id: true, nome: true } } } as const;
function comprovante(p: { id: string; status: string; createdAt: Date; aplicativoFornecedorId?: string; aplicativoSolicitanteId?: string; aplicativoFilial: { id: string; nome: string } | null }) {
  return { id: p.id, status: p.status, createdAt: p.createdAt.toISOString(), aplicativo: p.aplicativoFilial,
    filaExterna: Boolean(p.aplicativoFornecedorId && p.aplicativoFornecedorId !== p.aplicativoSolicitanteId) };
}
type ConfirmacaoManual = {
  where: { aplicativoSolicitanteId: string; autorId: string; chaveIdempotencia: string };
  hashEntrada: string;
};
async function recuperarConfirmacao({ where, hashEntrada }: ConfirmacaoManual) {
  const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where, select: { ...comprovanteSelect, hashEntrada: true } });
  if (!pedido) return null;
  if (pedido.hashEntrada !== hashEntrada) return resposta({ error: "Esta confirmação já foi usada para outro conteúdo. As alterações atuais não foram aplicadas.", pedidoExistente: comprovante(pedido) }, 409);
  return resposta(comprovante(pedido));
}
function falha(error: unknown) {
  if (error instanceof ErroMetragemPedido) return resposta({ error: error.message, codigo: error.codigo }, error.status);
  if (error instanceof ErroFilaOlist || error instanceof ErroAutorizacaoOlist || error instanceof ErroDirecionamentoPedidos) return resposta({ error: error.message }, error.status);
  if (error instanceof z.ZodError) { const detalhes = detalharErrosFilaOlist(error); return resposta(Object.keys(detalhes.campos).length ? detalhes : { error: "Revise vendedor, cliente, itens e dados comerciais." }, 400); }
  return resposta({ error: "Não foi possível concluir a operação. Confira a integração e tente novamente." }, 502);
}
export async function GET(request: Request) {
  try {
    const usuario = await autorizarPedidoManual(request);
    const params = new URL(request.url).searchParams;
    if (params.get("acao") === "estampas") return resposta(await consultarEstampasPedido(params));
    if (params.get("acao") === "tamanhos") return resposta(await consultarTamanhosPedido(params));
    const pedidoId = params.get("pedidoId");
    if (pedidoId) {
      if (!z.guid().safeParse(pedidoId).success) throw new ErroFilaOlist("Pedido inválido.");
      const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where: {
        id: pedidoId, tipoOrigem: "MANUAL", aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id,
      }, select: comprovanteSelect });
      if (!pedido) throw new ErroFilaOlist("Comprovante não encontrado.", 404);
      return resposta(comprovante(pedido));
    }
    if (params.get("acao") === "resolver") {
      const ids = z.object({ vendedorOrigemId: z.coerce.number().int().positive(), clienteOrigemId: z.coerce.number().int().positive(), aplicativoOrigemId: z.guid() }).parse({
        vendedorOrigemId: params.get("vendedorOrigemId"), clienteOrigemId: params.get("clienteOrigemId"), aplicativoOrigemId: params.get("aplicativoOrigemId"),
      });
      const referencia = await obterReferenciaPedidoManual(usuario, ids);
      const contextoOrigem = await resolverContaPedidoManual(usuario, referencia.aplicativoId);
      const { nome, cpfCnpj, uf } = referencia.cliente;
      const matrizId = contextoOrigem.fornecedor?.matrizId ?? usuario.aplicativoId;
      const decisao = await resolverDirecionamentoPedido(matrizId, { nome, cpfCnpj, uf });
      const selecoes = await resolverCorrespondenciaPedidoManual(usuario, referencia, decisao.aplicativoId, { validarDadosDirecionamento: true });
      const destino = await resolverContaPedidoManual(usuario, decisao.aplicativoId);
      const fornecedorManual = contextoOrigem.fornecedor ? await capturarFornecedorPedidoManual(usuario, referencia.aplicativoId, decisao.aplicativoId) : undefined;
      return resposta({ referencia, decisao, aplicativoDestino: destino.conta, ...(fornecedorManual ? { fornecedorManual } : {}),
        selecoes: { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId, vendedorFixo: selecoes.vendedorFixo } });
    }
    if (!params.has("aplicativoId")) {
      const opcoes = await listarReferenciasPedidoManual(usuario.aplicativoId);
      const referencia = opcoes[0];
      if (!referencia) throw new ErroFilaOlist("Nenhum aplicativo de referência autorizado.", 403);
      return resposta({ aplicativos: opcoes, aplicativoPadraoId: referencia.id });
    }
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, params.get("aplicativoId")!);
    if (!params.has("recurso")) return resposta({ conta, vendedorId, vendedorFixo: vendedorId !== null });
    return resposta(await consultarCadastrosFilaOlist(conta.id, params, { vendedorId }, request.signal));
  } catch (error) { return falha(error); }
}
export async function POST(request: Request) {
  let confirmacao: ConfirmacaoManual | null = null;
  try {
    const usuario = await autorizarPedidoManual(request);
    const payload: unknown = await request.json().catch(() => null);
    const atual = pedidoManualSchema.safeParse(payload);
    const original = atual.success ? atual.data : pedidoManualLegadoSchema.parse(payload);
    const hashEntrada = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    const where = { aplicativoSolicitanteId: usuario.aplicativoId, autorId: usuario.id, chaveIdempotencia: original.chaveIdempotencia };
    confirmacao = { where, hashEntrada };
    // Repetir um aceite não repete consultas externas nem muda seu resultado.
    const existente = await recuperarConfirmacao(confirmacao);
    if (existente) return existente;
    if (!atual.success) throw new ErroFilaOlist("Atualize a página e revise a origem e o direcionamento do pedido.", 409);
    const entrada = atual.data;
    exigirComerciaisCriacao(entrada.selecoes, entrada.itens.some(i => i.corteLaser));
    const contextoOrigem = await resolverContaPedidoManual(usuario, entrada.origemManual.aplicativoId);
    const matrizId = contextoOrigem.fornecedor?.matrizId ?? usuario.aplicativoId;
    const origem = await obterReferenciaPedidoManual(usuario, {
      aplicativoOrigemId: entrada.origemManual.aplicativoId,
      vendedorOrigemId: entrada.origemManual.vendedor.id, clienteOrigemId: entrada.origemManual.cliente.id,
    });
    const { nome, cpfCnpj, uf } = origem.cliente;
    const decisao = await resolverDirecionamentoPedido(matrizId, { nome, cpfCnpj, uf });
    if (JSON.stringify(origem) !== JSON.stringify(entrada.origemManual) || JSON.stringify(decisao) !== JSON.stringify(entrada.decisaoDirecionamento) || decisao.aplicativoId !== entrada.aplicativoId) {
      throw new ErroFilaOlist("Cliente ou regras alterados. Revise o direcionamento antes de incluir na fila.", 409);
    }
    const correspondencia = await resolverCorrespondenciaPedidoManual(usuario, origem, decisao.aplicativoId, { validarDadosDirecionamento: true });
    if (entrada.selecoes.clienteId !== correspondencia.clienteId || entrada.selecoes.vendedorId !== correspondencia.vendedorId) throw new ErroFilaOlist("Cadastros do destino alterados. Revise o pedido.", 409);
    const { conta, vendedorId } = await resolverContaPedidoManual(usuario, entrada.aplicativoId);
    const fornecedorManual = contextoOrigem.fornecedor ? await capturarFornecedorPedidoManual(usuario, origem.aplicativoId, conta.id) : undefined;
    if (JSON.stringify(fornecedorManual) !== JSON.stringify(entrada.fornecedorManual)) {
      throw new ErroFilaOlist("Vínculos do fornecedor alterados. Revise o pedido antes de incluir.", 409);
    }
    if (vendedorId !== null) {
      if (entrada.selecoes.vendedorId !== vendedorId) throw new ErroFilaOlist("Use o vendedor vinculado nesta conta.", 403);
    }
    // O aceite valida apenas os cadastros obrigatórios. Produtos, preços,
    // pagamento e laser permanecem no snapshot e são conferidos na revisão,
    // antes de qualquer criação real na Olist.
    const dados = montarDadosPedidoManual({ ...entrada, fornecedorManual });
    const resultado = await prisma.$transaction(async tx => {
      if (fornecedorManual) await bloquearFornecedorPedidoManual(tx, fornecedorManual);
      // O cadastro de vínculos usa FOR UPDATE no mesmo usuário.
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuario.id}::uuid FOR SHARE`;
      const atual = await tx.usuario.findUnique({ where: { id: usuario.id }, select: {
        ativo: true, aplicativoId: true, podeCriarOlistPedido: true, vinculosOlistVersao: true,
      } });
      if (!atual?.ativo || !atual.podeCriarOlistPedido || atual.aplicativoId !== usuario.aplicativoId) throw new ErroFilaOlist("Permissões alteradas. Atualize a página.", 403);
      if (atual.vinculosOlistVersao !== usuario.vinculosOlistVersao) throw new ErroFilaOlist("Vínculos do vendedor alterados. Revise o pedido.", 409);
      if (fornecedorManual) await validarFornecedorPedidoManual(tx, fornecedorManual);
      await validarVersaoDirecionamento(tx, matrizId, decisao);
      if (!await bloquearDestinoFornecedor(tx, matrizId, origem.aplicativoId)) throw new ErroFilaOlist("Referência alterada. Revise o pedido.", 409);
      if (!await bloquearDestinoFornecedor(tx, matrizId, conta.id)) throw new ErroFilaOlist("Destino alterado. Revise o pedido.", 409);
      await validarMetragensPedido(entrada.itens, tx);
      return tx.pedidoFornecedorQueue.create({ data: { ...where, aplicativoFornecedorId: matrizId,
        fornecedorId: fornecedorManual?.fornecedorId ?? null,
        tipoOrigem: "MANUAL", hashEntrada, vendedorFixo: vendedorId !== null,
        aplicativoFilialId: conta.id, direcionadoPorId: usuario.id, direcionadoEm: new Date(),
        dadosPedido: dados as unknown as Prisma.InputJsonValue, status: "PENDENTE",
      }, select: comprovanteSelect });
    });
    return resposta(comprovante(resultado), 201);
  } catch (error) {
    // O aceite concorrente pode terminar durante qualquer consulta/validação,
    // não apenas ao disputar a constraint. Recuperar sempre antes de rejeitar.
    if (confirmacao) {
      try {
        const atual = await autorizarPedidoManual(request);
        if (atual.id === confirmacao.where.autorId && atual.aplicativoId === confirmacao.where.aplicativoSolicitanteId) {
          const existente = await recuperarConfirmacao(confirmacao);
          if (existente) return existente;
        }
      } catch { /* Sem autorização/banco, preservar o erro original e a chave no cliente. */ }
    }
    return falha(error);
  }
}
