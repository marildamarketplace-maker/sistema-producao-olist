import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

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
    endpoint: string;
    data?: unknown;
    config?: AxiosRequestConfig;
  }> = [];

  context.mock.method(
    axios,
    "post",
    async (endpoint: string, data?: unknown, config?: AxiosRequestConfig) => {
      chamadas.push({ endpoint, data, config });
      return {
        data: { messageId: "mensagem-1" },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      } as AxiosResponse;
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
      chamadas[0].endpoint,
      "https://api.z-api.io/instances/instancia-teste/token/token-teste/send-text",
    );

    assert.equal(
      chamadas[0].config?.headers?.["Client-Token"],
      "client-token-teste",
    );
    assert.equal(chamadas[0].config?.headers?.["Content-Type"], "application/json");
    assert.deepEqual(chamadas[0].data, {
      phone: "5537988031061",
      message: "Resumo da baixa de estoque\n\nSucessos: 10\nErros: 0",
    });
  } finally {
    restoreEnv("ZAPI_INSTANCE_API", envAnterior.instanceApi);
    restoreEnv("ZAPI_CLIENT_TOKEN", envAnterior.clientToken);
  }
});

test("não confirma a notification quando a Z-API retorna 200 sem id de envio", async (context) => {
  const envAnterior = {
    instanceApi: process.env.ZAPI_INSTANCE_API,
    clientToken: process.env.ZAPI_CLIENT_TOKEN,
  };

  process.env.ZAPI_INSTANCE_API =
    "https://api.z-api.io/instances/instancia-teste/token/token-teste/send-text";
  process.env.ZAPI_CLIENT_TOKEN = "client-token-teste";

  let endpointChamado = "";
  context.mock.method(
    axios,
    "post",
    async (endpoint: string) => {
      endpointChamado = endpoint;
      return {
        data: "<html>Página inesperada</html>",
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      } as AxiosResponse;
    },
  );

  const notification: NotificationPendente = {
    id: "notification-2",
    tipo: "WHATSAPP",
    to: "5537988031061",
    titulo: "Erro no processamento",
    mensagem: "Não foi possível concluir o job.",
    data: new Date("2026-10-02T12:00:00.000Z"),
    tentativas: 0,
  };

  try {
    await assert.rejects(
      enviarNotificationWhatsapp(notification),
      /não confirmou o envio com zaapId ou messageId/,
    );
    assert.equal(
      endpointChamado,
      "https://api.z-api.io/instances/instancia-teste/token/token-teste/send-text",
    );
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
