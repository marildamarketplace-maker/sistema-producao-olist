import assert from "node:assert/strict";
import test from "node:test";
import {
  obterWhatsappErrosConfigurado,
  registrarErro,
} from "../src/lib/error-handler";

test("lê o destinatário de erros exclusivamente da variável de ambiente", () => {
  const valorAnterior = process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
  try {
    process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER = "5537988031061";
    assert.equal(obterWhatsappErrosConfigurado(), "5537988031061");

    delete process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
    assert.throws(
      () => obterWhatsappErrosConfigurado(),
      /WHATSAPP_ERROR_NOTIFICATION_NUMBER não configurada/,
    );
  } finally {
    if (valorAnterior === undefined) {
      delete process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
    } else {
      process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER = valorAnterior;
    }
  }
});

test("registra console.error sem criar resposta HTTP quando data não é informado", async (context) => {
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => logs.push(args));

  const retorno = await registrarErro({
    contexto: "Falha no worker",
    error: new Error("provedor indisponível"),
    notificar: false,
  });

  assert.equal(retorno, undefined);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "Falha no worker");
});

test("retorna NextResponse.json quando data é informado", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const response = await registrarErro({
    contexto: "Falha na API",
    error: new Error("entrada inválida"),
    data: { error: "entrada inválida", codigo: "INVALID_INPUT" },
    status: 422,
    notificar: false,
  });

  assert.ok(response);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "entrada inválida",
    codigo: "INVALID_INPUT",
  });
});

test("não entra em recursão quando a configuração da notification falha", async (context) => {
  const logs: unknown[][] = [];
  const valorAnterior = process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
  context.mock.method(console, "error", (...args: unknown[]) => logs.push(args));

  try {
    delete process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
    await assert.doesNotReject(
      registrarErro({
        contexto: "Falha original",
        error: new Error("erro original"),
      }),
    );
    assert.equal(logs.length, 2);
    assert.match(String(logs[1][0]), /Falha ao registrar notification/);
  } finally {
    if (valorAnterior === undefined) {
      delete process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER;
    } else {
      process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER = valorAnterior;
    }
  }
});
