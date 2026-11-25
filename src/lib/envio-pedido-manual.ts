import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { criarPedidoOlistSeguro, ErroCriacaoOlist } from "@/lib/olist";
import { bloquearDestinoFornecedor } from "@/lib/fila-fornecedor-destino";
import { envioBloqueado, envioExpirado, ErroEnvioFornecedor } from "@/lib/envio-fornecedor";

export const marcadorPedidoManual = (id: string) => `Pedido manual da fila: ${id}`;
export const jsonManual = (valor: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(valor));
export async function bloquearPedidoManual(tx: Prisma.TransactionClient, filaId: string) {
  await tx.$queryRaw`SELECT id FROM pedido_fornecedor_queue WHERE id=${filaId}::uuid FOR UPDATE`;
}
export async function marcarManualInterrompido(filaId: string) {
  await prisma.$transaction(async tx => {
    await bloquearPedidoManual(tx, filaId);
    const envio = await tx.envioPedidoManual.findUnique({ where: { filaId } });
    if (!envio || envio.estado !== "RESERVADO" || !envioExpirado(envio.iniciadoEm)) return;
    await tx.envioPedidoManual.update({ where: { filaId }, data: { estado: "INCERTO", diagnostico: "Tentativa interrompida. Confira o resultado na Olist antes de reenviar." } });
    await tx.pedidoFornecedorQueue.updateMany({ where: { id: filaId, status: "PROCESSAR" }, data: { status: "FALHADO", versao: { increment: 1 } } });
  });
}
export async function enviarPedidoManual(contexto: { filaId: string; versao: number; matrizId: string; aplicativoId: string; usuarioId: string; vendedorFixo?: { autorId: string; vendedorId: number }; payload: Record<string, unknown> }) {
  const { filaId, aplicativoId, usuarioId } = contexto;
  const tentativaId = randomUUID();
  const payload = { ...contexto.payload, observacoesInternas: `${String(contexto.payload.observacoesInternas ?? "")}\n\n${marcadorPedidoManual(filaId)}` };
  await prisma.$transaction(async tx => {
    if (contexto.vendedorFixo) {
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${contexto.vendedorFixo.autorId}::uuid FOR SHARE`;
      const vinculo = await tx.usuarioVendedorOlist.findFirst({ where: {
        usuarioId: contexto.vendedorFixo.autorId, aplicativoId,
        usuario: { aplicativoId: contexto.matrizId },
      }, select: { vendedorOlistId: true } });
      if (vinculo?.vendedorOlistId !== contexto.vendedorFixo.vendedorId) throw new ErroEnvioFornecedor("Vínculo do vendedor alterado. Gere outra prévia.");
    }
    await bloquearPedidoManual(tx, filaId);
    const envio = await tx.envioPedidoManual.findUnique({ where: { filaId } });
    if (envio && envioBloqueado(envio.estado)) throw new ErroEnvioFornecedor("Envio em andamento, concluído ou incerto. Confira a tentativa existente.");
    if (!await bloquearDestinoFornecedor(tx, contexto.matrizId, aplicativoId)) throw new ErroEnvioFornecedor("Destino não autorizado.");
    const atualizado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: filaId, tipoOrigem: "MANUAL",
      aplicativoFornecedorId: contexto.matrizId, aplicativoFilialId: aplicativoId, versao: contexto.versao,
      status: { in: ["PENDENTE", "FALHADO"] } }, data: { status: "PROCESSAR", versao: { increment: 1 } } });
    if (atualizado.count !== 1) throw new ErroEnvioFornecedor("Pedido alterado ou bloqueado. Gere outra prévia.");
    const historico = Array.isArray(envio?.historico) ? envio.historico : [];
    const dados = { tentativaId, aplicativoId, usuarioId, estado: "RESERVADO", iniciadoEm: new Date(), chamadaEm: null,
      pedidoOlistId: null, diagnostico: null, payload: jsonManual(payload),
      historico: jsonManual([...historico, ...(envio ? [{ acao: "RESULTADO_ANTERIOR", tentativaId: envio.tentativaId, estado: envio.estado, pedidoOlistId: envio.pedidoOlistId }] : []), { acao: "RESERVA", tentativaId, aplicativoId, usuarioId, em: new Date().toISOString() }]) };
    await tx.envioPedidoManual.upsert({ where: { filaId }, create: { filaId, ...dados }, update: dados });
  });
  let pedidoOlistId: string | undefined;
  try {
    await prisma.envioPedidoManual.update({ where: { filaId, tentativaId, estado: "RESERVADO" }, data: { chamadaEm: new Date() } });
    const resultado = await criarPedidoOlistSeguro(aplicativoId, payload);
    const id = String(resultado?.id ?? "");
    if (!/^[1-9]\d*$/.test(id)) throw new ErroCriacaoOlist("ID inválido na resposta Olist.", false);
    pedidoOlistId = id;
    await prisma.$transaction(async tx => {
      await bloquearPedidoManual(tx, filaId);
      // Uma recuperação passiva pode ter marcado INCERTO enquanto a chamada terminava.
      await tx.envioPedidoManual.update({ where: { filaId, tentativaId, estado: { in: ["RESERVADO", "INCERTO"] } }, data: { estado: "CONCLUIDO", pedidoOlistId: id, diagnostico: null } });
      await tx.pedidoFornecedorQueue.update({ where: { id: filaId }, data: { status: "CONCLUIDO", versao: { increment: 1 } } });
    });
    return { ...resultado, status: "CONCLUIDO" };
  } catch (error) {
    const rejeitado = error instanceof ErroCriacaoOlist && error.rejeitado;
    const diagnostico = rejeitado ? error.message : "Resultado incerto. Confira o pedido na conta Olist antes de liberar outra tentativa.";
    await prisma.$transaction(async tx => {
      await bloquearPedidoManual(tx, filaId);
      const alterado = await tx.envioPedidoManual.updateMany({ where: { filaId, tentativaId, estado: { in: ["RESERVADO", "INCERTO"] } },
        data: { estado: rejeitado ? "REJEITADO" : "INCERTO", diagnostico, ...(pedidoOlistId ? { pedidoOlistId } : {}) } });
      if (alterado.count) await tx.pedidoFornecedorQueue.updateMany({ where: { id: filaId, status: { not: "CONCLUIDO" } }, data: { status: "FALHADO", versao: { increment: 1 } } });
    }).catch(() => undefined); // A reserva durável bloqueia duplicidade se o banco cair.
    throw new ErroEnvioFornecedor(diagnostico);
  }
}
