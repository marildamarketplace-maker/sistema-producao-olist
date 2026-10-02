import {
  Notification,
  NotificationStatus,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { NotificationStatusAposFalha } from "@/services/notification/notificationRetryPolicy";

const LIMITE_MAXIMO_LOTE = 100;

function validarLimite(limite: number) {
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO_LOTE) {
    throw new Error(`limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO_LOTE}.`);
  }
}

export async function assumirNotificationsPendentes(input: {
  limite: number;
  workerId: string;
  lockTimeoutMs: number;
  destinatarios?: string[];
}): Promise<Notification[]> {
  validarLimite(input.limite);
  if (!input.workerId.trim()) throw new Error("workerId é obrigatório.");
  if (!Number.isInteger(input.lockTimeoutMs) || input.lockTimeoutMs <= 0) {
    throw new Error("lockTimeoutMs deve ser um inteiro maior que zero.");
  }
  if (input.destinatarios?.length === 0) return [];

  const lockExpiradoAntesDe = new Date(Date.now() - input.lockTimeoutMs);
  const filtroDestinatarios = input.destinatarios
    ? Prisma.sql`AND "to" IN (${Prisma.join(input.destinatarios)})`
    : Prisma.empty;
  return prisma.$queryRaw<Notification[]>`
    WITH candidatas AS (
      SELECT id
      FROM notification
      WHERE status = 'PENDENTE'::"NotificationStatus"
        AND data <= CURRENT_TIMESTAMP
        AND (processando_em IS NULL OR processando_em < ${lockExpiradoAntesDe})
        ${filtroDestinatarios}
      ORDER BY data ASC, created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${input.limite}
    ), assumidas AS (
      UPDATE notification AS notification
      SET processando_em = CURRENT_TIMESTAMP,
          worker_id = ${input.workerId}::uuid,
          tentativas = notification.tentativas + 1,
          ultimo_erro = NULL,
          updated_at = CURRENT_TIMESTAMP
      FROM candidatas
      WHERE notification.id = candidatas.id
      RETURNING notification.*
    )
    SELECT
      id,
      tipo,
      "to",
      titulo,
      mensagem,
      data,
      status,
      tentativas,
      ultimo_erro AS "ultimoErro",
      processando_em AS "processandoEm",
      worker_id AS "workerId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM assumidas
    ORDER BY data ASC, created_at ASC, id ASC
  `;
}

export async function concluirNotification(id: string, workerId: string) {
  const resultado = await prisma.notification.updateMany({
    where: {
      id,
      workerId,
      status: NotificationStatus.PENDENTE,
    },
    data: {
      status: NotificationStatus.SUCESSO,
      processandoEm: null,
      workerId: null,
      ultimoErro: null,
    },
  });
  return resultado.count === 1;
}

export async function falharNotification(
  id: string,
  workerId: string,
  erro: string,
  status: NotificationStatusAposFalha,
) {
  const resultado = await prisma.notification.updateMany({
    where: {
      id,
      workerId,
      status: NotificationStatus.PENDENTE,
    },
    data: {
      status,
      processandoEm: null,
      workerId: null,
      ultimoErro: erro.slice(0, 2_000),
    },
  });
  return resultado.count === 1;
}

export type NotificationPendente = Pick<
  Notification,
  "id" | "tipo" | "to" | "titulo" | "mensagem" | "data" | "tentativas"
>;

export { NotificationStatus, NotificationType };
