import assert from "node:assert/strict";
import test from "node:test";

import type { NotificationPendente } from "../src/repositories/notificationRepository";
import { enviarNotificationWhatsapp } from "../src/services/notification/whatsappNotificationSender";

test("envia a notificação de WhatsApp por meio da Z-API", async (context) => {
  const envAnterior = {
    instanceApi: process.env.ZAPI_INSTANCE_API,
    clientToken: process.env.ZAPI_CLIENT_TOKEN,
  };

  process.env.ZAPI_INSTANCE_API =
    "https://api.z-api.io/instances/instancia-teste/token/token-teste";
  process.env.ZAPI_CLIENT_TOKEN = "client-token-teste";

  const chamadas: Array<{
    input: string | URL | Request;
    init?: RequestInit;
  }> = [];

  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ input, init });
      return new Response(JSON.stringify({ messageId: "mensagem-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  const notification: NotificationPendente = {
    id: "notification-1",
    tipo: "WHATSAPP",
    to: "+55 (37) 98803-1061",
    titulo: "Resumo da baixa de estoque",
    mensagem: "Sucessos: 10\nErros: 0",
    data: new Date("2026-10-02T12:00:00.000Z"),
    tentativas: 0,
  };

  try {
    await enviarNotificationWhatsapp(notification);

    assert.equal(chamadas.length, 1);
    assert.equal(
      String(chamadas[0].input),
      "https://api.z-api.io/instances/instancia-teste/token/token-teste/send-text",
    );

    const headers = new Headers(chamadas[0].init?.headers);
    assert.equal(headers.get("Client-Token"), "client-token-teste");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(chamadas[0].init?.body)), {
      phone: "5537988031061",
      message: "Resumo da baixa de estoque\n\nSucessos: 10\nErros: 0",
    });
  } finally {
    restoreEnv("ZAPI_INSTANCE_API", envAnterior.instanceApi);
    restoreEnv("ZAPI_CLIENT_TOKEN", envAnterior.clientToken);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
