import { randomUUID } from "node:crypto";
import type { NotificationPendente } from "@/repositories/notificationRepository";
import {
  NotificationStatusAposFalha,
  obterStatusNotificationAposFalha,
} from "@/services/notification/notificationRetryPolicy";

const LIMITE_PADRAO = 50;
const CONCORRENCIA_PADRAO = 5;
const LOCK_TIMEOUT_MS = 5 * 60 * 1_000;

type NotificationType = NotificationPendente["tipo"];
type NotificationExecutor = (notification: NotificationPendente) => Promise<void>;

export type NotificationProcessorDependencies = {
  assumirPendentes: (input: {
    limite: number;
    workerId: string;
    lockTimeoutMs: number;
    destinatarios?: string[];
  }) => Promise<NotificationPendente[]>;
  concluir: (id: string, workerId: string) => Promise<boolean>;
  falhar: (
    id: string,
    workerId: string,
    erro: string,
    status: NotificationStatusAposFalha,
  ) => Promise<boolean>;
  executores: Record<NotificationType, NotificationExecutor>;
  criarWorkerId: () => string;
  registrarErro?: (error: unknown, notification: NotificationPendente) => Promise<void>;
};

async function carregarDependencies(): Promise<NotificationProcessorDependencies> {
  const [repository, whatsapp] = await Promise.all([
    import("@/repositories/notificationRepository"),
    import("@/services/notification/whatsappNotificationSender"),
  ]);
  return {
    assumirPendentes: repository.assumirNotificationsPendentes,
    concluir: repository.concluirNotification,
    falhar: repository.falharNotification,
    executores: { WHATSAPP: whatsapp.enviarNotificationWhatsapp },
    criarWorkerId: randomUUID,
    registrarErro: async (error, notification) => {
      const { registrarErro } = await import("@/lib/error-handler");
      await registrarErro({
        contexto: `[notification] Falha ao processar notification ${notification.id}.`,
        error,
        notificar: false,
      });
    },
  };
}

export type ResultadoProcessamentoNotifications = {
  encontradas: number;
  sucessos: number;
  erros: number;
};

export async function processarNotificationsPendentes(
  options: {
    limite?: number;
    concorrencia?: number;
    destinatarios?: string[];
  } = {},
  dependencies?: NotificationProcessorDependencies,
): Promise<ResultadoProcessamentoNotifications> {
  const deps = dependencies ?? await carregarDependencies();
  const limite = options.limite ?? LIMITE_PADRAO;
  const concorrencia = options.concorrencia ?? CONCORRENCIA_PADRAO;
  if (!Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 20) {
    throw new Error("concorrencia deve ser um inteiro entre 1 e 20.");
  }

  const workerId = deps.criarWorkerId();
  const notifications = await deps.assumirPendentes({
    limite,
    workerId,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
    destinatarios: options.destinatarios,
  });
  const resultado: ResultadoProcessamentoNotifications = {
    encontradas: notifications.length,
    sucessos: 0,
    erros: 0,
  };
  let proximoIndice = 0;

  async function processarProxima() {
    while (proximoIndice < notifications.length) {
      const notification = notifications[proximoIndice++];
      try {
        await deps.executores[notification.tipo](notification);
        if (!(await deps.concluir(notification.id, workerId))) {
          throw new Error("Lock da notification foi perdido antes da conclusão.");
        }
        resultado.sucessos += 1;
      } catch (error) {
        const mensagem = error instanceof Error ? error.message : "Erro inesperado ao processar notification.";
        await deps.registrarErro?.(error, notification);
        await deps.falhar(
          notification.id,
          workerId,
          mensagem,
          obterStatusNotificationAposFalha(notification.tentativas),
        );
        resultado.erros += 1;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concorrencia, notifications.length) },
      () => processarProxima(),
    ),
  );
  return resultado;
}
