import { operarRecuperacaoFila } from "@/lib/fila-recuperacao-operacao";
import { estadoRecuperacao } from "@/lib/fila-recuperacao-olist";
import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { consultarFilaManualOlist, operarFilaManualOlist } from "@/lib/fila-manual-olist";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { obterVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { z } from "zod";
import { capturarVendedorFila, bloquearVendedorFila, validarOperadorFornecedor } from "@/lib/vendedor-fila-producao";
import { vendedorOrigemFilaSchema } from "@/lib/vendedor-fila-contrato";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { dadosPedidoFilaSchema } from "@/lib/fila-fornecedor-contrato";
import { selecoesFilaOlistSchema } from "@/lib/fila-olist-contrato";
import { montarPedidoFornecedor, ErroMontagemFornecedor } from "@/lib/pedido-fornecedor-montagem";
import { marcarEnvioInterrompido, enviarFornecedor, envioBloqueado, envioExpirado, marcadorFornecedor, ErroEnvioFornecedor } from "@/lib/envio-fornecedor";
import { obterPedidoOlistApi } from "@/lib/olist";
import { consultarCadastrosFilaOlist, validarCadastros, nome, ErroFilaOlist as ErroFila } from "@/lib/fila-olist-cadastros";
import { destinoFornecedorWhere } from "@/lib/fila-fornecedor-destino";

export const maxDuration = 120;


type Contexto = { params: Promise<{ id: string }> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function autorizar(request: Request, contexto: Contexto) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroFila("Sessão expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: { aplicativoId: true, podeGerenciarFilaPedidos: true, ativo: true } });
  if (!usuario?.podeGerenciarFilaPedidos || usuario.ativo === false) throw new ErroFila("Sem permissão para gerenciar fila de pedidos.", 403);
  const { id } = await contexto.params;
  if (!z.guid().safeParse(id).success) throw new ErroFila("Pedido inválido.");
  const fila = await prisma.pedidoFornecedorQueue.findFirst({ where: { id, aplicativoFornecedorId: usuario.aplicativoId } });
  if (!fila) throw new ErroFila("Pedido não encontrado.", 404);
  return { fila, usuarioId: auth.id, matrizId: usuario.aplicativoId };
}
async function filialValida(matrizId: string, filialId: string | null) {
  if (!filialId || !z.guid().safeParse(filialId).success) throw new ErroFila("Salve um aplicativo destinatário antes de configurar o envio.");
  const filial = await prisma.aplicativo.findFirst({ where: destinoFornecedorWhere(matrizId, filialId), select: { id: true, nome: true } });
  if (!filial) throw new ErroFila("Aplicativo destinatário não vinculado ao fornecedor.", 403);
  return filial;
}
function falha(error: unknown) {
  if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Dados comerciais inválidos; gere outra prévia." }, { status: 400 });
  if (error instanceof ErroFila || error instanceof ErroEnvioFornecedor || error instanceof ErroMontagemFornecedor) return NextResponse.json({ error: error.message }, { status: error instanceof ErroFila ? error.status : 409 });
  return NextResponse.json({ error: "Não foi possível concluir a operação. Verifique a integração da conta destinatária e tente atualizar a fila." }, { status: 502 });
}
const resposta = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, contexto: Contexto) {
  try {
    const { fila, matrizId, usuarioId } = await autorizar(request, contexto);
    const params = new URL(request.url).searchParams;
    if (fila.tipoOrigem === "MANUAL") return resposta(await consultarFilaManualOlist({ fila, matrizId, usuarioId }, params));
    const solicitacaoId = fila.solicitacaoProducaoId;
    if (!solicitacaoId) throw new ErroFila("Solicitação da fila inválida.", 409);
    const filial = await filialValida(matrizId, fila.aplicativoFilialId);
    const recurso = params.get("recurso") ?? "inicial";
    if (recurso === "inicial") {
      await marcarEnvioInterrompido(solicitacaoId);
      const envio = await prisma.envioFornecedor.findUnique({ where: { solicitacaoId }, include: { aplicativo: { select: { nome: true } } } });
      const snapshot = dadosPedidoFilaSchema.safeParse(fila.dadosPedido);
      const configuracao = snapshot.success && snapshot.data.olist?.filialId === filial.id ? snapshot.data.olist : null;
      return resposta({ filial, versao: fila.versao, selecoes: configuracao?.selecoes ?? null, recuperacao: snapshot.success ? estadoRecuperacao(snapshot.data, filial.id) : null,
        vendedorOrigem: snapshot.success ? snapshot.data.vendedorOrigem ?? null : null,
        vendedorFixo: snapshot.success && snapshot.data.vendedorOrigem?.tipo === "VINCULO",
        vendedorOlistPadraoId: snapshot.success && snapshot.data.vendedorOrigem?.aplicativoId === filial.id ? snapshot.data.vendedorOrigem.vendedorOlistId : await obterVendedorDoUsuario(usuarioId, filial.id), envio: envio ? { estado: envio.estado, pedidoOlistId: envio.pedidoOlistId,
        aplicativoNome: envio.aplicativo?.nome, diagnostico: envio.diagnostico, iniciadoEm: envio.iniciadoEm, aplicativoId: envio.aplicativoId, tentativaId: envio.tentativaId } : null });
    }
    return resposta(await consultarCadastrosFilaOlist(filial.id, params));
  } catch (error) { return falha(error); }
}
const bodySchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("preview"), versao: z.number().int(), selecoes: selecoesFilaOlistSchema, vendedorFonte: z.enum(["VINCULO", "MANUAL"]).optional() }).strict(),
  z.object({ acao: z.literal("confirmar"), previaId: z.guid() }).strict(),
  z.object({ acao: z.literal("vincular"), tentativaId: z.guid(), pedidoOlistId: z.string().regex(/^[1-9]\d*$/), justificativa: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ acao: z.literal("confirmar-ausencia"), tentativaId: z.guid(), justificativa: z.string().trim().min(10).max(1000), ausenciaConfirmada: z.literal(true) }).strict(),
]);
export async function POST(request: Request, contexto: Contexto) {
  try {
    const { fila, matrizId, usuarioId } = await autorizar(request, contexto);
    const entrada: unknown = await request.json().catch(() => null);
    if (entrada && typeof entrada === "object" && "acao" in entrada && entrada.acao === "recuperar") return resposta(await operarRecuperacaoFila(fila, matrizId, usuarioId, entrada));
    if (fila.tipoOrigem === "MANUAL") return resposta(await operarFilaManualOlist({ fila, matrizId, usuarioId }, entrada));
    const solicitacaoId = fila.solicitacaoProducaoId, fornecedorId = fila.fornecedorId;
    if (!solicitacaoId || !fornecedorId) throw new ErroFila("Origem da fila inválida.", 409);
    const parsed = bodySchema.safeParse(entrada);
    if (!parsed.success) throw new ErroFila("Revise os campos obrigatórios, IDs e valores informados.");
    const body = parsed.data;
    const filial = await filialValida(matrizId, fila.aplicativoFilialId);
    if (fila.status === "CANCELADO" || fila.status === "CONCLUIDO") throw new ErroFila("Pedido bloqueado para envio.", 409);
    if (body.acao === "vincular" || body.acao === "confirmar-ausencia") {
      const envio = await prisma.envioFornecedor.findUnique({ where: { solicitacaoId } });
      if (!envio || envio.tentativaId !== body.tentativaId || !["RESERVADO", "INCERTO"].includes(envio.estado) || (!envioExpirado(envio.iniciadoEm) && envio.estado === "RESERVADO")) throw new ErroFila("Tentativa alterada ou ainda em andamento. Aguarde e atualize.", 409);
      await filialValida(matrizId, envio.aplicativoId);
      if (body.acao === "vincular") {
        const pedido = await obterPedidoOlistApi(envio.aplicativoId, body.pedidoOlistId);
        if (String(pedido.id) !== body.pedidoOlistId || !String(pedido.observacoesInternas ?? "").includes(marcadorFornecedor(solicitacaoId))) throw new ErroFila("Pedido não corresponde à solicitação na conta destinatária. Confira o ID e o identificador nas observações internas.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid FOR UPDATE`;
        const atual = await tx.envioFornecedor.findUnique({ where: { solicitacaoId } });
        if (!atual || atual.tentativaId !== body.tentativaId || atual.estado !== envio.estado) throw new ErroFila("Tentativa alterada. Atualize.", 409);
        const historico = Array.isArray(atual.historico) ? atual.historico : [];
        if (body.acao === "vincular") {
          const existente = await tx.pedidoFornecedorSolicitacao.findFirst({ where: { solicitacaoId } });
          if (existente) throw new ErroFila("Solicitação já registrada.", 409);
          await tx.pedidoFornecedorSolicitacao.create({ data: { solicitacaoId, fornecedorId, aplicativoDestinatarioId: envio.aplicativoId, pedidoOlistId: body.pedidoOlistId } });
        } else if (atual.pedidoOlistId) throw new ErroFila("Há um ID Olist registrado na tentativa; confira e vincule esse pedido antes de liberar reenvio.", 409);
        await tx.envioFornecedor.update({ where: { solicitacaoId }, data: {
          estado: body.acao === "vincular" ? "CONCLUIDO" : "LIBERADO", diagnostico: null,
          ...(body.acao === "vincular" ? { pedidoOlistId: body.pedidoOlistId } : {}),
          historico: json([...historico, { acao: body.acao, usuarioId, justificativa: body.justificativa, em: new Date().toISOString(), tentativaId: body.tentativaId }]),
        } });
        await tx.pedidoFornecedorQueue.update({ where: { id: fila.id }, data: { status: body.acao === "vincular" ? "CONCLUIDO" : "PENDENTE", versao: { increment: 1 } } });
      });
      return resposta({ status: body.acao === "vincular" ? "CONCLUIDO" : "PENDENTE" });
    }
    if (body.acao === "confirmar") {
      const previa = await prisma.previaFornecedor.findFirst({ where: { id: body.previaId, filaId: fila.id, filialId: filial.id, usuarioId, versao: fila.versao, expiraEm: { gt: new Date() } } });
      if (!previa) throw new ErroFila("Prévia expirada ou pedido alterado. Gere outra prévia.", 409);
      const confirmado = selecoesFilaOlistSchema.extend({ vendedorOrigem: vendedorOrigemFilaSchema }).safeParse(previa.selecoes);
      if (!confirmado.success) throw new ErroFila("Revise a origem do vendedor e gere uma nova prévia.", 409);
      const { vendedorOrigem: origemVendedor, ...selecionados } = confirmado.data;
      if (origemVendedor.aplicativoSolicitanteId !== fila.aplicativoSolicitanteId || origemVendedor.matrizId !== matrizId || origemVendedor.aplicativoId !== filial.id || origemVendedor.vendedorOlistId !== selecionados.vendedorId) throw new ErroFila("Origem do vendedor alterada. Gere outra prévia.", 409);
      await prisma.$transaction(tx => bloquearVendedorFila(tx, origemVendedor));
      const dadosAtuais = dadosPedidoFilaSchema.parse(fila.dadosPedido);
      await validarCadastros(filial.id, selecionados, dadosAtuais.itens.some((i) => i.corteLaser));
      const resultado = await enviarFornecedor({ solicitacaoId, fornecedorId, aplicativoId: filial.id, usuarioId,
        payload: previa.payload as Record<string, unknown>, origemVendedor, fila: { id: fila.id, versao: fila.versao, matrizId } });
      return resposta({ ...resultado, status: "CONCLUIDO" });
    }
    if (fila.versao !== body.versao || !["PENDENTE", "FALHADO"].includes(fila.status)) throw new ErroFila("Pedido alterado ou em processamento. Atualize.", 409);
    const envio = await prisma.envioFornecedor.findUnique({ where: { solicitacaoId } });
    if (envio && envioBloqueado(envio.estado)) throw new ErroFila("Existe uma tentativa sem conciliação. Confira o resultado antes de enviar novamente.", 409);
    const dados = dadosPedidoFilaSchema.safeParse(fila.dadosPedido);
    if (!dados.success) throw new ErroFila("JSON do pedido inválido.");
    const selecoes = body.selecoes;
    const salva = dados.data.vendedorOrigem;
    if (!body.vendedorFonte && !salva) throw new ErroFila("Confirme a escolha manual do vendedor antes de revisar este pedido.", 409);
    if (salva?.tipo === "VINCULO" && body.vendedorFonte !== "MANUAL" && (salva.aplicativoId !== filial.id || salva.vendedorOlistId !== selecoes.vendedorId)) throw new ErroFila("Vendedor do autor alterado. Confirme uma escolha manual ou corrija o vínculo.", 409);
    const origemVendedor = salva?.tipo === "VINCULO" && body.vendedorFonte !== "MANUAL" ? salva : await capturarVendedorFila({
      usuarioId, aplicativoSolicitanteId: fila.aplicativoSolicitanteId, matrizId, aplicativoId: filial.id, vendedorOlistId: selecoes.vendedorId, fonte: "MANUAL",
    });
    await prisma.$transaction(tx => bloquearVendedorFila(tx, origemVendedor));
    const tecidos = new Set(dados.data.itens.map((i) => i.tecido.id));
    if (selecoes.tecidos.length !== tecidos.size || new Set(selecoes.tecidos.map((i) => i.tecidoId)).size !== tecidos.size || selecoes.tecidos.some((i) => !tecidos.has(i.tecidoId))) throw new ErroFila("Associe exatamente um produto para cada tecido.");
    const { plano, cliente, forma, vendedor, nomes } = await validarCadastros(filial.id, selecoes, dados.data.itens.some((i) => i.corteLaser));
    const linhas = dados.data.itens.map((item) => {
      const produto = selecoes.tecidos.find((i) => i.tecidoId === item.tecido.id)!;
      return { referencia: String(produto.id), nome: item.tecido.nome, preco: produto.preco, quantidade: item.quantidadeTecido,
        quantidadeSolicitada: item.quantidade, unidadeSolicitada: item.unidade, sku: item.sku, estampa: item.estampa, variante: item.variante ?? "", laser: item.corteLaser, tamanho: item.tamanho, tipo: item.tipoProduto };
    });
    const payload = montarPedidoFornecedor(linhas, { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId,
      formaId: selecoes.formaId, plano: plano.planoPagamento.nome, tipoVenda: selecoes.tipoVenda, observacao: dados.data.observacao },
      selecoes.laser ? { referencia: String(selecoes.laser.id), preco: selecoes.laser.preco } : null);
    payload.observacoesInternas += `\n\n${marcadorFornecedor(solicitacaoId)}`;
    const versao = fila.versao + 1;
    const previa = await prisma.$transaction(async (tx) => {
      await bloquearVendedorFila(tx, origemVendedor);
      await validarOperadorFornecedor(tx, usuarioId, matrizId);
      await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid FOR UPDATE`;
      const envioAtual = await tx.envioFornecedor.findUnique({ where: { solicitacaoId } });
      if (envioAtual && envioBloqueado(envioAtual.estado)) throw new ErroFila("Existe uma tentativa em andamento ou sem conferência. Atualize a fila.", 409);
      const atualizado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: fila.id, aplicativoFornecedorId: matrizId,
        aplicativoFilialId: filial.id, versao: fila.versao, status: { in: ["PENDENTE", "FALHADO"] } },
        data: { dadosPedido: json({ ...(fila.dadosPedido as Prisma.JsonObject), olistAnterior: undefined, recuperacaoOlist: undefined, olist: { filialId: filial.id, selecoes }, vendedorOrigem: origemVendedor }), versao: { increment: 1 } } });
      if (atualizado.count !== 1) throw new ErroFila("Pedido alterado durante a revisão. Atualize a fila.", 409);
      return tx.previaFornecedor.create({ data: { filaId: fila.id, filialId: filial.id, usuarioId, versao,
        payload: json(payload), selecoes: json({ ...selecoes, vendedorOrigem: origemVendedor }), expiraEm: new Date(Date.now() + 15 * 60_000) } });
    });
    return resposta({ previaId: previa.id, versao, payload, cliente: nome(cliente), vendedor: nome(vendedor), forma: nome(forma), plano: plano.planoPagamento.nome,
      produtos: Object.fromEntries(nomes), filial, expiraEm: previa.expiraEm });
  } catch (error) { return falha(error); }
}
