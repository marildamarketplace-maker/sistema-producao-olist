import type { PedidoFornecedorQueue } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dadosPedidoFilaSchema } from "@/lib/fila-fornecedor-contrato";
import { selecoesFilaOlistSchema } from "@/lib/fila-olist-contrato";
import { consultarCadastrosFilaOlist, validarCadastros, nome, ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { montarPedidoFornecedor } from "@/lib/pedido-fornecedor-montagem";
import { destinoFornecedorWhere, bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { obterVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { validarVendedorPedidoOlist } from "@/lib/olist-escopo-vendedor";
import { obterPedidoOlistApi } from "@/lib/olist";
import { envioBloqueado, envioExpirado } from "@/lib/envio-fornecedor";
import { bloquearPedidoManual, marcarManualInterrompido, marcadorPedidoManual, enviarPedidoManual, jsonManual } from "@/lib/envio-pedido-manual";
import { validarReferenciaPersistidaPedidoManual } from "@/lib/pedido-manual-correspondencia";
import { guardaReferenciaFilaManual, obterAutorReferenciaFilaManual, validarAtoresFilaManual } from "@/lib/fila-manual-referencia";
import { capturarFornecedorPedidoManual, mesmaConfirmacaoFornecedorManual } from "@/lib/pedido-manual-fornecedor";
import { fornecedorManualSchema } from "@/lib/pedido-manual-referencia";

type Contexto = { fila: PedidoFornecedorQueue; matrizId: string; usuarioId: string };
const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("preview"), versao: z.number().int().nonnegative(), selecoes: selecoesFilaOlistSchema }).strict(),
  z.object({ acao: z.literal("confirmar"), previaId: z.guid() }).strict(),
  z.object({ acao: z.literal("vincular"), tentativaId: z.guid(), pedidoOlistId: z.string().regex(/^[1-9]\d*$/), justificativa: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ acao: z.literal("confirmar-ausencia"), tentativaId: z.guid(), justificativa: z.string().trim().min(10).max(1000), ausenciaConfirmada: z.literal(true) }).strict(),
]);
const selecoesPreviaSchema = selecoesFilaOlistSchema.extend({ fornecedorManual: fornecedorManualSchema.optional() });
async function contaValida(matrizId: string, filialId: string | null) {
  if (!filialId) throw new ErroFilaOlist("Selecione a conta destinatária.");
  const filial = await prisma.aplicativo.findFirst({ where: destinoFornecedorWhere(matrizId, filialId), select: { id: true, nome: true } });
  if (!filial) throw new ErroFilaOlist("Conta destinatária não autorizada.", 403);
  return filial;
}
async function vendedorFixo(fila: PedidoFornecedorQueue, contaId: string) {
  if (!fila.vendedorFixo) return null;
  const id = fila.autorId ? await obterVendedorDoUsuario(fila.autorId, contaId) : null;
  if (!id) throw new ErroFilaOlist("O autor vendedor não possui mais vínculo nesta conta. Corrija o cadastro antes de revisar.", 409);
  return id;
}
async function validarSelecoes(fila: PedidoFornecedorQueue, contaId: string, selecoes: z.infer<typeof selecoesFilaOlistSchema>) {
  const snapshot = dadosPedidoFilaSchema.parse(fila.dadosPedido);
  const fixo = await vendedorFixo(fila, contaId);
  if (fixo !== null) {
    if (selecoes.vendedorId !== fixo) throw new ErroFilaOlist("Preserve o vendedor vinculado ao autor deste pedido.", 403);
  }
  const autor = snapshot.origemManual ? await obterAutorReferenciaFilaManual(fila.autorId, fila.aplicativoSolicitanteId) : null;
  const fornecedorManual = snapshot.fornecedorManual && autor && snapshot.origemManual
    ? await capturarFornecedorPedidoManual(autor, snapshot.origemManual.aplicativoId, contaId) : undefined;
  if (fornecedorManual && fornecedorManual.matrizId !== fila.aplicativoFornecedorId) throw new ErroFilaOlist("Fornecedor não corresponde à fila.", 403);
  const referencia = snapshot.origemManual && autor
    ? await validarReferenciaPersistidaPedidoManual(autor, snapshot.origemManual, contaId, selecoes) : null;
  const cadastros = await validarCadastros(contaId, selecoes, snapshot.itens.some(i => i.corteLaser), referencia?.cadastros);
  if (fixo !== null) validarVendedorPedidoOlist(cadastros.cliente, fixo);
  return { ...cadastros, guardaReferencia: autor && snapshot.origemManual ? guardaReferenciaFilaManual(autor, snapshot.origemManual, fornecedorManual) : undefined };
}
export async function consultarFilaManualOlist({ fila, matrizId }: Contexto, params: URLSearchParams) {
  const filial = await contaValida(matrizId, fila.aplicativoFilialId);
  if ((params.get("recurso") ?? "inicial") !== "inicial") {
    return consultarCadastrosFilaOlist(filial.id, params, { vendedorId: await vendedorFixo(fila, filial.id) });
  }
  await marcarManualInterrompido(fila.id);
  const envio = await prisma.envioPedidoManual.findUnique({ where: { filaId: fila.id }, select: {
    estado: true, pedidoOlistId: true, diagnostico: true, iniciadoEm: true, aplicativoId: true, tentativaId: true,
  } });
  const snapshot = dadosPedidoFilaSchema.parse(fila.dadosPedido);
  const padrao = fila.vendedorFixo && fila.autorId ? await obterVendedorDoUsuario(fila.autorId, filial.id) : null;
  const salvas = snapshot.olist?.filialId === filial.id ? snapshot.olist.selecoes : null;
  // Mudança do vínculo do autor exige nova escolha de cliente, sem usar o vínculo do administrador.
  const selecoes = !snapshot.origemManual && salvas && padrao !== null && salvas.vendedorId !== padrao
    ? { ...salvas, vendedorId: padrao, clienteId: undefined } : salvas;
  return { filial, selecoes, vendedorOlistPadraoId: padrao, vendedorFixo: fila.vendedorFixo, envio };
}
export async function operarFilaManualOlist({ fila, matrizId, usuarioId }: Contexto, entrada: unknown) {
  const body = schema.parse(entrada);
  const filial = await contaValida(matrizId, fila.aplicativoFilialId);
  if (["CANCELADO", "CONCLUIDO"].includes(fila.status)) throw new ErroFilaOlist("Pedido encerrado.", 409);
  if (body.acao === "vincular" || body.acao === "confirmar-ausencia") {
    const envio = await prisma.envioPedidoManual.findUnique({ where: { filaId: fila.id } });
    if (!envio || envio.tentativaId !== body.tentativaId || !["RESERVADO", "INCERTO"].includes(envio.estado) ||
      (envio.estado === "RESERVADO" && !envioExpirado(envio.iniciadoEm))) throw new ErroFilaOlist("Tentativa alterada ou ainda em andamento.", 409);
    await contaValida(matrizId, envio.aplicativoId);
    if (body.acao === "vincular") {
      const pedido = await obterPedidoOlistApi(envio.aplicativoId, body.pedidoOlistId);
      if (String(pedido.id) !== body.pedidoOlistId || !String(pedido.observacoesInternas ?? "").split(/\r?\n/).includes(marcadorPedidoManual(fila.id))) throw new ErroFilaOlist("Pedido não corresponde ao identificador desta fila.");
    } else if (envio.pedidoOlistId) throw new ErroFilaOlist("Há um ID Olist registrado. Confira e vincule o pedido.", 409);
    const status = body.acao === "vincular" ? "CONCLUIDO" : "PENDENTE";
    await prisma.$transaction(async tx => {
      await bloquearPedidoManual(tx, fila.id);
      const atual = await tx.envioPedidoManual.findUnique({ where: { filaId: fila.id } });
      if (!atual || atual.tentativaId !== envio.tentativaId || atual.estado !== envio.estado || atual.pedidoOlistId !== envio.pedidoOlistId) throw new ErroFilaOlist("Tentativa alterada. Atualize a fila.", 409);
      if (!await bloquearDestinoFornecedor(tx, matrizId, envio.aplicativoId)) throw new ErroFilaOlist("Conta da tentativa não autorizada.", 403);
      await tx.envioPedidoManual.update({ where: { filaId: fila.id }, data: { estado: status === "CONCLUIDO" ? "CONCLUIDO" : "LIBERADO", diagnostico: null,
        ...(body.acao === "vincular" ? { pedidoOlistId: body.pedidoOlistId } : {}),
        historico: jsonManual([...(Array.isArray(atual.historico) ? atual.historico : []), { acao: body.acao, usuarioId, justificativa: body.justificativa, tentativaId: body.tentativaId, em: new Date().toISOString() }]) } });
      await tx.pedidoFornecedorQueue.update({ where: { id: fila.id }, data: { status, versao: { increment: 1 } } });
    });
    return { status, ...(body.acao === "vincular" ? { id: body.pedidoOlistId } : {}) };
  }
  if (body.acao === "confirmar") {
    const previa = await prisma.previaFornecedor.findFirst({ where: { id: body.previaId, filaId: fila.id, filialId: filial.id, usuarioId, versao: fila.versao, expiraEm: { gt: new Date() } } });
    if (!previa) throw new ErroFilaOlist("Prévia expirada ou alterada. Gere outra prévia.", 409);
    const { fornecedorManual, ...selecionados } = selecoesPreviaSchema.parse(previa.selecoes);
    const validacao = await validarSelecoes(fila, filial.id, selecionados);
    if (!mesmaConfirmacaoFornecedorManual(fornecedorManual, validacao.guardaReferencia?.fornecedorManual)) {
      throw new ErroFilaOlist("Vínculo do fornecedor alterado após a prévia. Revise o pedido novamente.", 409);
    }
    return enviarPedidoManual({ filaId: fila.id, versao: fila.versao, matrizId, aplicativoId: filial.id, usuarioId,
      ...(fila.vendedorFixo && fila.autorId ? { vendedorFixo: { autorId: fila.autorId, vendedorId: selecionados.vendedorId } } : {}),
      guardaReferencia: validacao.guardaReferencia, payload: previa.payload as Record<string, unknown> });
  }
  if (body.versao !== fila.versao || !["PENDENTE", "FALHADO"].includes(fila.status)) throw new ErroFilaOlist("Pedido alterado ou bloqueado.", 409);
  const selecoes = body.selecoes;
  const dados = dadosPedidoFilaSchema.parse(fila.dadosPedido);
  const ids = new Set(dados.itens.map(i => i.tecido.id));
  if (selecoes.tecidos.length !== ids.size || new Set(selecoes.tecidos.map(t => t.tecidoId)).size !== ids.size || selecoes.tecidos.some(t => !ids.has(t.tecidoId))) throw new ErroFilaOlist("Associe um produto a cada tecido.");
  const { plano, cliente, vendedor, forma, nomes, guardaReferencia } = await validarSelecoes(fila, filial.id, selecoes);
  const produtos = new Map(selecoes.tecidos.map(t => [t.tecidoId, t]));
  const linhas = dados.itens.map(i => ({ referencia: String(produtos.get(i.tecido.id)!.id), nome: i.tecido.nome,
    preco: produtos.get(i.tecido.id)!.preco, quantidade: i.quantidadeTecido, quantidadeSolicitada: i.quantidade, unidadeSolicitada: i.unidade,
    sku: i.sku, estampa: i.estampa, variante: i.variante ?? "", laser: i.corteLaser, tamanho: i.tamanho, tipo: i.tipoProduto }));
  const payload = montarPedidoFornecedor(linhas, { clienteId: selecoes.clienteId, vendedorId: selecoes.vendedorId,
    formaId: selecoes.formaId, plano: plano.planoPagamento.nome, tipoVenda: selecoes.tipoVenda, observacao: dados.observacao },
    selecoes.laser ? { referencia: String(selecoes.laser.id), preco: selecoes.laser.preco } : null);
  const versao = fila.versao + 1;
  const previa = await prisma.$transaction(async tx => {
    await validarAtoresFilaManual(tx, usuarioId, matrizId, guardaReferencia);
    await bloquearPedidoManual(tx, fila.id);
    const envio = await tx.envioPedidoManual.findUnique({ where: { filaId: fila.id } });
    if (envio && envioBloqueado(envio.estado)) throw new ErroFilaOlist("Tentativa em andamento ou sem conciliação.", 409);
    if (!await bloquearDestinoFornecedor(tx, matrizId, filial.id)) throw new ErroFilaOlist("Destino alterado.", 409);
    if (guardaReferencia && !await bloquearDestinoFornecedor(tx, matrizId, guardaReferencia.origemAplicativoId)) throw new ErroFilaOlist("Aplicativo de referência alterado.", 409);
    const atualizado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: fila.id, aplicativoFornecedorId: matrizId, aplicativoFilialId: filial.id,
      versao: body.versao, status: { in: ["PENDENTE", "FALHADO"] } }, data: {
        dadosPedido: jsonManual({ ...dados, ...(guardaReferencia?.fornecedorManual ? { fornecedorManual: guardaReferencia.fornecedorManual } : {}),
          olist: { filialId: filial.id, selecoes } }), versao: { increment: 1 },
      } });
    if (atualizado.count !== 1) throw new ErroFilaOlist("Pedido alterado durante a revisão.", 409);
    return tx.previaFornecedor.create({ data: { filaId: fila.id, filialId: filial.id, usuarioId, versao,
      selecoes: jsonManual({ ...selecoes, ...(guardaReferencia?.fornecedorManual ? { fornecedorManual: guardaReferencia.fornecedorManual } : {}) }),
      payload: jsonManual(payload), expiraEm: new Date(Date.now() + 15 * 60_000) } });
  });
  return { previaId: previa.id, versao, payload, cliente: nome(cliente), vendedor: nome(vendedor), forma: nome(forma), plano: plano.planoPagamento.nome, produtos: Object.fromEntries(nomes), filial, expiraEm: previa.expiraEm };
}
