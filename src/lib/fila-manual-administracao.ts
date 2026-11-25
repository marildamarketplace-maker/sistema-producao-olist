import type { Prisma } from "@prisma/client";
import { bloquearPedidoManual, jsonManual } from "@/lib/envio-pedido-manual";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { envioBloqueado } from "@/lib/envio-fornecedor";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { dadosPedidoFilaSchema } from "@/lib/fila-fornecedor-contrato";
import { prisma } from "@/lib/prisma";
import { obterVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { guardaReferenciaFilaManual, obterAutorReferenciaFilaManual, validarAtoresFilaManual, type GuardaReferenciaFilaManual } from "@/lib/fila-manual-referencia";
import { capturarFornecedorPedidoManual } from "@/lib/pedido-manual-fornecedor";

type EntradaAlteracaoFilaManual = {
  pedidoId: string; aplicativoId: string; usuarioId: string; versao: number; filialId?: string;
};
export type ReferenciaRedirecionamentoManual = {
  filialId: string; versao: number; vendedorId?: number; guarda: GuardaReferenciaFilaManual;
};

/** As consultas Olist terminam antes da transação que bloqueia a fila. */
export async function prepararRedirecionamentoFilaManual(entrada: EntradaAlteracaoFilaManual): Promise<ReferenciaRedirecionamentoManual | null> {
  if (!entrada.filialId) return null;
  const pedido = await prisma.pedidoFornecedorQueue.findFirst({ where: {
    id: entrada.pedidoId, aplicativoFornecedorId: entrada.aplicativoId, tipoOrigem: "MANUAL",
  }, select: { autorId: true, aplicativoSolicitanteId: true, vendedorFixo: true, aplicativoFilialId: true, dadosPedido: true, status: true, versao: true } });
  if (!pedido) throw new ErroFilaOlist("Pedido não encontrado.", 404);
  if (pedido.versao !== entrada.versao || !["PENDENTE", "FALHADO"].includes(pedido.status)) throw new ErroFilaOlist("Pedido alterado ou encerrado. Atualize a fila.", 409);
  const snapshot = dadosPedidoFilaSchema.parse(pedido.dadosPedido);
  if (!snapshot.origemManual || pedido.aplicativoFilialId === entrada.filialId) return null;
  if (entrada.filialId === entrada.aplicativoId && await prisma.aplicativo.findFirst({
    where: { aplicativoPaiId: entrada.aplicativoId }, select: { id: true },
  })) throw new ErroFilaOlist("Selecione um aplicativo filho como destinatário deste pedido.", 403);
  const envio = await prisma.envioPedidoManual.findUnique({ where: { filaId: entrada.pedidoId }, select: { estado: true, pedidoOlistId: true } });
  if (envio && (envio.pedidoOlistId || envioBloqueado(envio.estado))) throw new ErroFilaOlist("Envio concluído, em andamento ou incerto. Confira a tentativa antes de alterar.", 409);
  const autor = await obterAutorReferenciaFilaManual(pedido.autorId, pedido.aplicativoSolicitanteId);
  const fornecedorManual = snapshot.fornecedorManual ? await capturarFornecedorPedidoManual(autor, snapshot.origemManual.aplicativoId, entrada.filialId) : undefined;
  const vendedorId = pedido.vendedorFixo ? await obterVendedorDoUsuario(autor.id, entrada.filialId) : null;
  if (pedido.vendedorFixo && !vendedorId) throw new ErroFilaOlist("O autor vendedor não possui mais vínculo nesta conta. Corrija o cadastro antes de revisar.", 409);
  return { filialId: entrada.filialId, versao: pedido.versao,
    ...(vendedorId ? { vendedorId } : {}), guarda: guardaReferenciaFilaManual(autor, snapshot.origemManual, fornecedorManual) };
}

export async function alterarFilaManual(tx: Prisma.TransactionClient, entrada: EntradaAlteracaoFilaManual,
  referencia?: ReferenciaRedirecionamentoManual | null) {
  await validarAtoresFilaManual(tx, entrada.usuarioId, entrada.aplicativoId, referencia?.guarda);
  await bloquearPedidoManual(tx, entrada.pedidoId);
  const pedido = await tx.pedidoFornecedorQueue.findFirst({ where: { id: entrada.pedidoId, aplicativoFornecedorId: entrada.aplicativoId, tipoOrigem: "MANUAL" },
    select: { aplicativoFilialId: true, dadosPedido: true } });
  if (!pedido) throw new ErroFilaOlist("Pedido não encontrado.", 404);
  const envio = await tx.envioPedidoManual.findUnique({ where: { filaId: entrada.pedidoId }, select: { estado: true, pedidoOlistId: true } });
  if (envio && (envio.pedidoOlistId || envioBloqueado(envio.estado))) throw new ErroFilaOlist("Envio concluído, em andamento ou incerto. Confira a tentativa antes de alterar.", 409);
  if (entrada.filialId && !await bloquearDestinoFornecedor(tx, entrada.aplicativoId, entrada.filialId)) throw new ErroFilaOlist("Destino não autorizado.", 403);
  const snapshot = dadosPedidoFilaSchema.parse(pedido.dadosPedido);
  // Nunca transportar IDs comerciais entre contas; o vínculo fixo do autor será resolvido na revisão.
  const mudouConta = entrada.filialId && entrada.filialId !== pedido.aplicativoFilialId;
  const cancelado = !entrada.filialId;
  const direcionadoEm = new Date();
  if (mudouConta && snapshot.origemManual) {
    if (!referencia || referencia.filialId !== entrada.filialId || referencia.versao !== entrada.versao ||
        referencia.guarda.origemAplicativoId !== snapshot.origemManual.aplicativoId || !pedido.aplicativoFilialId) {
      throw new ErroFilaOlist("Valide cliente e vendedor no novo aplicativo antes de alterar o destino.", 409);
    }
    if (!await bloquearDestinoFornecedor(tx, entrada.aplicativoId, snapshot.origemManual.aplicativoId)) throw new ErroFilaOlist("Aplicativo de referência alterado. Revise o pedido.", 409);
    if (entrada.filialId === entrada.aplicativoId && await tx.aplicativo.findFirst({
      where: { aplicativoPaiId: entrada.aplicativoId }, select: { id: true },
    })) throw new ErroFilaOlist("Selecione um aplicativo filho como destinatário deste pedido.", 403);
    if ((snapshot.direcionamentoManual?.alteracoes.length ?? 0) >= 1000) throw new ErroFilaOlist("Limite de alterações de destino atingido.", 409);
  }
  const dadosPedido = mudouConta ? { ...snapshot,
    ...(referencia?.guarda.fornecedorManual ? { fornecedorManual: referencia.guarda.fornecedorManual } : {}),
    olistAnterior: snapshot.olistAnterior ?? snapshot.olist,
    recuperacaoOlist: undefined,
    olist: referencia && snapshot.origemManual ? { filialId: entrada.filialId!, selecoes: {
      ...(referencia.vendedorId ? { vendedorId: referencia.vendedorId } : {}), tipoVenda: snapshot.olist?.selecoes.tipoVenda,
    } } : undefined,
    ...(snapshot.direcionamentoManual && pedido.aplicativoFilialId ? { direcionamentoManual: {
      ...snapshot.direcionamentoManual, alteracoes: [...snapshot.direcionamentoManual.alteracoes,
        { usuarioId: entrada.usuarioId, em: direcionadoEm.toISOString(), anteriorId: pedido.aplicativoFilialId, aplicativoId: entrada.filialId! }],
    } } : {}),
  } : snapshot;
  const resultado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: entrada.pedidoId, aplicativoFornecedorId: entrada.aplicativoId,
    tipoOrigem: "MANUAL", versao: entrada.versao, status: { in: ["PENDENTE", "FALHADO"] } }, data: {
      status: cancelado ? "CANCELADO" : "PENDENTE", versao: { increment: 1 },
      dadosPedido: jsonManual(cancelado ? { ...snapshot, cancelamento: { usuarioId: entrada.usuarioId, em: direcionadoEm.toISOString() } } : dadosPedido),
      ...(!cancelado ? { aplicativoFilialId: entrada.filialId, direcionadoEm, direcionadoPorId: entrada.usuarioId } : {}),
    } });
  if (resultado.count !== 1) throw new ErroFilaOlist("Pedido alterado ou encerrado. Atualize a fila.", 409);
  return { id: entrada.pedidoId, filialId: entrada.filialId, status: cancelado ? "CANCELADO" : "PENDENTE", versao: entrada.versao + 1, direcionadoEm: direcionadoEm.toISOString() };
}
