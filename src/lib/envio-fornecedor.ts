import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { criarPedidoOlistSeguro, ErroCriacaoOlist } from "@/lib/olist";

export class ErroEnvioFornecedor extends Error {}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const marcadorFornecedor = (id: string) => `Solicitacao fornecedor: ${id}`;
export function envioBloqueado(estado: string) { return !["REJEITADO", "LIBERADO"].includes(estado); }
export function envioExpirado(iniciadoEm: Date, agora = new Date()) { return agora.getTime() - iniciadoEm.getTime() > 10 * 60_000; }

type ContextoEnvio = { solicitacaoId: string; fornecedorId: string; aplicativoId: string; usuarioId: string;
  payload: Record<string, unknown>; fila?: { id: string; versao: number; matrizId: string }; };

// O lock da solicitação protege ambos os fluxos; nenhuma transação permanece aberta durante HTTP.
export async function enviarFornecedor(contexto: ContextoEnvio) {
  const tentativaId = randomUUID();
  const marcador = marcadorFornecedor(contexto.solicitacaoId);
  const payload = { ...contexto.payload, observacoesInternas: String(contexto.payload.observacoesInternas ?? "").includes(marcador) ? contexto.payload.observacoesInternas : [contexto.payload.observacoesInternas, marcador].filter(Boolean).join("\n\n") };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${contexto.solicitacaoId}::uuid FOR UPDATE`;
    const existente = await tx.pedidoFornecedorSolicitacao.findFirst({ where: { solicitacaoId: contexto.solicitacaoId } });
    const envio = await tx.envioFornecedor.findUnique({ where: { solicitacaoId: contexto.solicitacaoId } });
    if (existente || (envio && envioBloqueado(envio.estado))) throw new ErroEnvioFornecedor("Solicitação já enviada, em envio ou com resultado incerto. Confira o resultado antes de tentar novamente.");
    if (contexto.fila) {
      const filiais = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM aplicativo WHERE id = ${contexto.aplicativoId}::uuid AND aplicativo_pai_id = ${contexto.fila.matrizId}::uuid FOR SHARE`;
      if (!filiais.length) throw new ErroEnvioFornecedor("A filial não pertence mais à matriz.");
      const atualizado = await tx.pedidoFornecedorQueue.updateMany({ where: { id: contexto.fila.id,
        aplicativoFornecedorId: contexto.fila.matrizId, versao: contexto.fila.versao, aplicativoFilialId: contexto.aplicativoId,
        status: { in: ["PENDENTE", "FALHADO"] } }, data: { status: "PROCESSAR", versao: { increment: 1 } } });
      if (atualizado.count !== 1) throw new ErroEnvioFornecedor("Pedido alterado ou bloqueado. Atualize a fila e gere uma nova prévia.");
    } else {
      // Um envio direto também respeita cancelamento e reservas da fila.
      const fila = await tx.pedidoFornecedorQueue.findUnique({ where: { solicitacaoProducaoId: contexto.solicitacaoId } });
      if (fila?.status === "CANCELADO" || fila?.status === "PROCESSAR" || fila?.status === "CONCLUIDO") throw new ErroEnvioFornecedor("Solicitação bloqueada na fila do fornecedor.");
    }
    const historico = Array.isArray(envio?.historico) ? envio.historico : [];
    const dados = { tentativaId, aplicativoId: contexto.aplicativoId, usuarioId: contexto.usuarioId,
      filaId: contexto.fila?.id ?? null, estado: "RESERVADO", iniciadoEm: new Date(), chamadaEm: null,
      pedidoOlistId: null, diagnostico: null, payload: json(payload),
      historico: json([...historico, ...(envio ? [{ acao: "RESULTADO_ANTERIOR", tentativaId: envio.tentativaId, estado: envio.estado, pedidoOlistId: envio.pedidoOlistId, diagnostico: envio.diagnostico, chamadaEm: envio.chamadaEm }] : []), { acao: "RESERVA", tentativaId, usuarioId: contexto.usuarioId, aplicativoId: contexto.aplicativoId, em: new Date().toISOString() }]) };
    await tx.envioFornecedor.upsert({ where: { solicitacaoId: contexto.solicitacaoId }, create: { solicitacaoId: contexto.solicitacaoId, ...dados }, update: dados });
  });
  let pedidoOlistId: string | undefined;
  try {
    // Persistido antes do POST: queda do processo deixa uma reserva que bloqueia novo envio.
    await prisma.envioFornecedor.update({ where: { solicitacaoId: contexto.solicitacaoId, tentativaId }, data: { chamadaEm: new Date() } });
    const resultado = await criarPedidoOlistSeguro(contexto.aplicativoId, payload);
    pedidoOlistId = String(resultado.id ?? "");
    if (!/^[1-9]\d*$/.test(pedidoOlistId)) throw new ErroCriacaoOlist("A Olist não retornou um ID válido. Resultado incerto; confira manualmente.", false);
    const registro = await prisma.$transaction(async (tx) => {
      const registro = await tx.pedidoFornecedorSolicitacao.create({ data: { pedidoOlistId: pedidoOlistId!, fornecedorId: contexto.fornecedorId,
        solicitacaoId: contexto.solicitacaoId, aplicativoDestinatarioId: contexto.aplicativoId } });
      await tx.envioFornecedor.update({ where: { solicitacaoId: contexto.solicitacaoId, tentativaId }, data: { estado: "CONCLUIDO", pedidoOlistId } });
      await tx.pedidoFornecedorQueue.updateMany({ where: { solicitacaoProducaoId: contexto.solicitacaoId }, data: { status: "CONCLUIDO", versao: { increment: 1 } } });
      return registro;
    });
    return { ...resultado, registroId: registro.id };
  } catch (error) {
    const rejeitado = error instanceof ErroCriacaoOlist && error.rejeitado;
    const diagnostico = rejeitado ? error.message : "Resultado incerto. Confira o pedido na conta Olist antes de liberar outra tentativa.";
    await prisma.$transaction(async (tx) => {
      await tx.envioFornecedor.updateMany({ where: { solicitacaoId: contexto.solicitacaoId, tentativaId, estado: "RESERVADO" },
        data: { estado: rejeitado ? "REJEITADO" : "INCERTO", diagnostico, ...(pedidoOlistId ? { pedidoOlistId } : {}) } });
      await tx.pedidoFornecedorQueue.updateMany({ where: { solicitacaoProducaoId: contexto.solicitacaoId, status: { not: "CONCLUIDO" } }, data: { status: "FALHADO", versao: { increment: 1 } } });
    }).catch(() => undefined); // A reserva permanece bloqueada mesmo se o banco estiver indisponível.
    throw new ErroEnvioFornecedor(diagnostico);
  }
}

/** Recuperação passiva: não cria nem repete pedidos; somente expõe a interrupção para conferência. */
export async function marcarEnvioInterrompido(solicitacaoId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM solicitacoes_producao WHERE id = ${solicitacaoId}::uuid FOR UPDATE`;
    const envio = await tx.envioFornecedor.findUnique({ where: { solicitacaoId } });
    if (!envio || envio.estado !== "RESERVADO" || !envioExpirado(envio.iniciadoEm)) return;
    await tx.envioFornecedor.update({ where: { solicitacaoId }, data: { estado: "INCERTO", diagnostico: "Tentativa interrompida. Resultado incerto; confira manualmente na Olist." } });
    await tx.pedidoFornecedorQueue.updateMany({ where: { solicitacaoProducaoId: solicitacaoId, status: { not: "CONCLUIDO" } }, data: { status: "FALHADO", versao: { increment: 1 } } });
  });
}
