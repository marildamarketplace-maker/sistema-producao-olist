import assert from "node:assert/strict";
import test from "node:test";
import { NotificationStatus, NotificationType, type Notification } from "@prisma/client";
import { processarNotificationsPendentes } from "../src/services/notificationService";

function criarNotification(id: string): Notification {
  return {
    id,
    tipo: NotificationType.WHATSAPP,
    to: "5511999999999",
    titulo: "Pedido aprovado",
    mensagem: "Seu pedido foi aprovado.",
    data: new Date(),
    status: NotificationStatus.PENDENTE,
    tentativas: 1,
    ultimoErro: null,
    processandoEm: new Date(),
    workerId: "00000000-0000-0000-0000-000000000001",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("processa notifications pendentes e conclui os envios bem-sucedidos", async () => {
  const executadas: string[] = [];
  const concluidas: string[] = [];
  const resultado = await processarNotificationsPendentes(
    { concorrencia: 2 },
    {
      criarWorkerId: () => "00000000-0000-0000-0000-000000000001",
      assumirPendentes: async () => [criarNotification("1"), criarNotification("2")],
      concluir: async (id) => {
        concluidas.push(id);
        return true;
      },
      falhar: async () => true,
      executores: {
        [NotificationType.WHATSAPP]: async (notification) => {
          executadas.push(notification.id);
        },
      },
    },
  );

  assert.deepEqual(resultado, { encontradas: 2, sucessos: 2, erros: 0 });
  assert.deepEqual(executadas.sort(), ["1", "2"]);
  assert.deepEqual(concluidas.sort(), ["1", "2"]);
});

test("isola falhas e continua processando o restante do lote", async () => {
  const falhas: Array<{ id: string; erro: string }> = [];
  const concluidas: string[] = [];
  const errosRegistrados: string[] = [];
  const resultado = await processarNotificationsPendentes(
    { concorrencia: 1 },
    {
      criarWorkerId: () => "00000000-0000-0000-0000-000000000001",
      registrarErro: async (error, notification) => {
        errosRegistrados.push(`${notification.id}:${error instanceof Error ? error.message : String(error)}`);
      },
      assumirPendentes: async () => [criarNotification("falha"), criarNotification("sucesso")],
      concluir: async (id) => {
        concluidas.push(id);
        return true;
      },
      falhar: async (id, _workerId, erro) => {
        falhas.push({ id, erro });
        return true;
      },
      executores: {
        [NotificationType.WHATSAPP]: async (notification) => {
          if (notification.id === "falha") throw new Error("provedor indisponível");
        },
      },
    },
  );

  assert.deepEqual(resultado, { encontradas: 2, sucessos: 1, erros: 1 });
  assert.deepEqual(concluidas, ["sucesso"]);
  assert.deepEqual(falhas, [{ id: "falha", erro: "provedor indisponível" }]);
  assert.deepEqual(errosRegistrados, ["falha:provedor indisponível"]);
});

test("não relata sucesso quando o lock é perdido durante a conclusão", async () => {
  const falhas: string[] = [];
  const resultado = await processarNotificationsPendentes(
    {},
    {
      criarWorkerId: () => "00000000-0000-0000-0000-000000000001",
      assumirPendentes: async () => [criarNotification("1")],
      concluir: async () => false,
      falhar: async (_id, _workerId, erro) => {
        falhas.push(erro);
        return false;
      },
      executores: {
        [NotificationType.WHATSAPP]: async () => undefined,
      },
    },
  );

  assert.deepEqual(resultado, { encontradas: 1, sucessos: 0, erros: 1 });
  assert.match(falhas[0], /Lock da notification foi perdido/);
});

test("repassa os destinatários habilitados ao repositório", async () => {
  let destinatariosRecebidos: string[] | undefined;

  await processarNotificationsPendentes(
    { destinatarios: ["5511999999999"] },
    {
      criarWorkerId: () => "00000000-0000-0000-0000-000000000001",
      assumirPendentes: async (input) => {
        destinatariosRecebidos = input.destinatarios;
        return [];
      },
      concluir: async () => true,
      falhar: async () => true,
      executores: {
        [NotificationType.WHATSAPP]: async () => undefined,
      },
    },
  );

  assert.deepEqual(destinatariosRecebidos, ["5511999999999"]);
});
