import type { Prisma } from "@prisma/client";
import { bloquearPedidoManual, jsonManual } from "@/lib/envio-pedido-manual";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { envioBloqueado } from "@/lib/envio-fornecedor";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { dadosPedidoFilaSchema } from "@/lib/fila-fornecedor-contrato";

export async function alterarFilaManual(tx: Prisma.TransactionClient, entrada: {
  pedidoId: string; aplicativoId: string; usuarioId: string; versao: number; filialId?: string;
}) {
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
  const dadosPedido = mudouConta ? { ...snapshot, olist: undefined } : snapshot;
  const cancelado = !entrada.filialId;
  const direcionadoEm = new Date();
  const resultado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: entrada.pedidoId, aplicativoFornecedorId: entrada.aplicativoId,
    tipoOrigem: "MANUAL", versao: entrada.versao, status: { in: ["PENDENTE", "FALHADO"] } }, data: {
      status: cancelado ? "CANCELADO" : "PENDENTE", versao: { increment: 1 },
      dadosPedido: jsonManual(cancelado ? { ...snapshot, cancelamento: { usuarioId: entrada.usuarioId, em: direcionadoEm.toISOString() } } : dadosPedido),
      ...(!cancelado ? { aplicativoFilialId: entrada.filialId, direcionadoEm, direcionadoPorId: entrada.usuarioId } : {}),
    } });
  if (resultado.count !== 1) throw new ErroFilaOlist("Pedido alterado ou encerrado. Atualize a fila.", 409);
  return { id: entrada.pedidoId, filialId: entrada.filialId, status: cancelado ? "CANCELADO" : "PENDENTE", versao: entrada.versao + 1, direcionadoEm: direcionadoEm.toISOString() };
}
