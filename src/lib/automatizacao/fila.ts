import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarDestinatariosWhatsapp, prepararDadosNotification } from "@/lib/notification";
import { z } from "zod";
import { prazoReservaMs } from "./renovacao";
import { mensagemWhatsappAutomatizacao } from "./mensagem-whatsapp";

export const operacaoWorker = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("reservar") }),
  z.object({ acao: z.literal("renovar"), reserva: z.uuid() }),
  z.object({
    acao: z.literal("finalizar"), reserva: z.uuid(),
    desfecho: z.enum(["SUCESSO", "FALHA", "TEMPORARIA", "INDISPONIVEL"]),
    resultado: z.string().max(8_000).refine((texto) => !texto.includes("\0")),
  }),
]);

type Escopo = { id: string; aplicativoId: string };
type Transacao = Prisma.TransactionClient;
type Execucao = Awaited<ReturnType<Transacao["execucaoAutomatizacao"]["findUniqueOrThrow"]>>;

const limiteTentativas = 3;

async function fechar(tx: Transacao, execucao: Execucao, reserva: string, status: string, resultado: string, agora: Date) {
  await tx.tentativaAutomatizacao.update({
    where: { id: reserva }, data: { status, resultado, encerradaEm: agora },
  });
  const indisponivel = status === "INDISPONIVEL";
  const reabrir = status === "AGUARDANDO_RETRY" || indisponivel;
  await tx.execucaoAutomatizacao.update({
    where: { id: execucao.id },
    data: {
      status: reabrir ? "AGUARDANDO_RETRY" : status,
      reserva: null, reservaAte: null, worker: null,
      disponivelEm: new Date(agora.getTime() + 60_000 * 2 ** Math.max(execucao.tentativa - 1, 0)),
      tentativa: indisponivel ? { decrement: 1 } : undefined,
    },
  });
  if (reabrir || execucao.tipo === "TESTE_ROTINA") return;
  const app = await tx.aplicativo.findUnique({ where: { id: execucao.aplicativoId }, select: { whatsapp: true } });
  let numeros: string[];
  try { numeros = app ? normalizarDestinatariosWhatsapp(app.whatsapp) : []; }
  catch { numeros = []; }
  const rotina = await tx.rotinaAutomatizacao.findUniqueOrThrow({
    where: { id: execucao.rotinaId }, select: { nome: true },
  });
  for (const numero of numeros) {
    const notification = await tx.notification.create({
      data: prepararDadosNotification({
        to: numero,
        ...mensagemWhatsappAutomatizacao(rotina.nome, status === "CONCLUIDA", resultado, agora),
      }),
    });
    await tx.avisoAutomatizacao.create({
      data: { tentativaId: reserva, notificationId: notification.id, destinatario: numero },
    });
  }
}

export async function operarFila(escopo: Escopo, operacao: z.infer<typeof operacaoWorker>) {
  return prisma.$transaction(async (tx) => {
    if (operacao.acao === "reservar") {
      const [chave] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM automatizacao_execucao
        WHERE "aplicativoId" = ${escopo.aplicativoId}::uuid AND tipo IN ('EXECUTAR_PROMPT', 'TESTE_ROTINA')
        AND ((status IN ('PENDENTE', 'AGUARDANDO_RETRY') AND "disponivelEm" <= now())
          OR (status = 'EM_EXECUCAO' AND "reservaAte" <= now()))
        ORDER BY "disponivelEm", id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!chave) return { trabalho: null };
      const agora = new Date();
      const execucao = await tx.execucaoAutomatizacao.findUniqueOrThrow({
        where: { id: chave.id }, include: { versao: { select: { markdown: true } }, rotina: { select: { nome: true } } },
      });
      if (execucao.reserva) {
        if (execucao.tentativa >= limiteTentativas) {
          await fechar(tx, execucao, execucao.reserva, "FALHA_FINAL", "RESERVA_EXPIRADA", agora);
          return { trabalho: null };
        }
        await tx.tentativaAutomatizacao.update({
          where: { id: execucao.reserva },
          data: { status: "RESERVA_EXPIRADA", encerradaEm: agora },
        });
      }
      const reserva = randomUUID();
      await tx.execucaoAutomatizacao.update({
        where: { id: execucao.id },
        data: { reserva, reservaAte: new Date(agora.getTime() + prazoReservaMs), worker: escopo.id,
          status: "EM_EXECUCAO", tentativa: { increment: 1 } },
      });
      await tx.tentativaAutomatizacao.create({
        data: { id: reserva, execucaoId: execucao.id, worker: escopo.id, rodada: execucao.rodada },
      });
      return { trabalho: { reserva, rotinaNome: execucao.rotina.nome, markdown: execucao.tipo === "TESTE_ROTINA"
        ? 'Retorne exatamente {"resultado":"TESTE_ROTINA_OK"}.' : execucao.versao.markdown } };
    }

    const [chave] = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM automatizacao_execucao e
      JOIN automatizacao_tentativa t ON t."execucaoId" = e.id
      WHERE t.id = ${operacao.reserva}::uuid AND t.worker = ${escopo.id}
        AND e."aplicativoId" = ${escopo.aplicativoId}::uuid AND e.tipo IN ('EXECUTAR_PROMPT', 'TESTE_ROTINA')
      FOR UPDATE OF e
    `;
    if (!chave) return null;
    const agora = new Date();
    const execucao = await tx.execucaoAutomatizacao.findUniqueOrThrow({ where: { id: chave.id } });
    const tentativa = await tx.tentativaAutomatizacao.findUniqueOrThrow({ where: { id: operacao.reserva } });
    if (operacao.acao === "finalizar" && tentativa.encerradaEm && tentativa.status !== "RESERVA_EXPIRADA" && tentativa.resultado !== "RESERVA_EXPIRADA") {
      return { status: tentativa.status };
    }
    if (execucao.reserva !== operacao.reserva || !execucao.reservaAte || execucao.reservaAte <= agora) return null;
    if (operacao.acao === "renovar") {
      await tx.execucaoAutomatizacao.update({
        where: { id: execucao.id }, data: { reservaAte: new Date(agora.getTime() + prazoReservaMs) },
      });
      return { ok: true };
    }
    const sucesso = operacao.desfecho === "SUCESSO" &&
      (execucao.tipo !== "TESTE_ROTINA" || operacao.resultado === "TESTE_ROTINA_OK");
    const status = sucesso ? "CONCLUIDA"
      : operacao.desfecho === "INDISPONIVEL" ? "INDISPONIVEL"
      : operacao.desfecho === "TEMPORARIA" && execucao.tentativa < limiteTentativas ? "AGUARDANDO_RETRY"
      : "FALHA_FINAL";
    await fechar(tx, execucao, operacao.reserva, status, operacao.resultado, agora);
    return { status };
  });
}
