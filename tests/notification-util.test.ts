import assert from "node:assert/strict";
import test from "node:test";
import type { Notification, Prisma } from "@prisma/client";
import {
  criarNotification,
  prepararDadosNotification,
  normalizarDestinatariosWhatsapp,
} from "../src/lib/notification";

const dataAgendada = new Date("2026-10-02T15:00:00.000Z");

function notificationPersistida(
  dados: Prisma.NotificationCreateInput,
): Notification {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tipo: dados.tipo,
    to: dados.to,
    titulo: dados.titulo,
    mensagem: dados.mensagem,
    data: dados.data as Date,
    status: dados.status ?? "PENDENTE",
    tentativas: 0,
    ultimoErro: null,
    processandoEm: null,
    workerId: null,
    createdAt: dataAgendada,
    updatedAt: dataAgendada,
  };
}

test("cria notification WhatsApp pendente com número normalizado", async () => {
  let recebido: Prisma.NotificationCreateInput | undefined;
  const resultado = await criarNotification(
    {
      to: "+55 (11) 99999-9999",
      titulo: " Pedido aprovado ",
      mensagem: " Seu pedido foi aprovado. ",
      data: dataAgendada,
    },
    async (dados) => {
      recebido = dados;
      return notificationPersistida(dados);
    },
  );

  assert.deepEqual(recebido, {
    tipo: "WHATSAPP",
    to: "5511999999999",
    titulo: " Pedido aprovado ",
    mensagem: " Seu pedido foi aprovado. ",
    data: dataAgendada,
    status: "PENDENTE",
  });
  assert.equal(resultado[0].status, "PENDENTE");
});

test("normaliza lista e enfileira uma notificação por número sem duplicatas", async () => {
  const recebidos: string[] = [];
  await criarNotification({
    to: "5537988031061, +55 (37) 8803-2390,5537988031061",
    titulo: "Alerta",
    mensagem: "Erro",
  }, async (dados) => {
    recebidos.push(dados.to);
    return notificationPersistida(dados);
  });
  assert.deepEqual(recebidos, ["5537988031061", "553788032390"]);
  assert.throws(() => normalizarDestinatariosWhatsapp(" , "), /válido/);
});

test("valida toda a lista antes de persistir e tenta todos os destinatários se houver falha", async () => {
  const recebidos: string[] = [];
  const persistir = async (dados: Prisma.NotificationCreateInput) => {
    recebidos.push(dados.to);
    if (dados.to === "5537988031061") throw new Error("Banco indisponível");
    return notificationPersistida(dados);
  };
  await assert.rejects(criarNotification({
    to: "5537988031061,inválido", titulo: "Alerta", mensagem: "Erro",
  }, persistir), /válido/);
  assert.deepEqual(recebidos, []);
  await assert.rejects(criarNotification({
    to: "5537988031061,553788032390", titulo: "Alerta", mensagem: "Erro",
  }, persistir), /1 de 2 notificações/);
  assert.deepEqual(recebidos, ["5537988031061", "553788032390"]);
});

test("usa a data atual quando o agendamento não é informado", () => {
  const antes = Date.now();
  const dados = prepararDadosNotification({
    to: "5511999999999",
    titulo: "Título",
    mensagem: "Mensagem",
  });
  const depois = Date.now();

  assert.ok(dados.data instanceof Date);
  assert.ok(dados.data.getTime() >= antes);
  assert.ok(dados.data.getTime() <= depois);
});

test("rejeita dados obrigatórios inválidos antes de acessar o banco", () => {
  assert.throws(
    () => prepararDadosNotification({
      to: "123",
      titulo: "Título",
      mensagem: "Mensagem",
    }),
    /número de WhatsApp válido/,
  );
  assert.throws(
    () => prepararDadosNotification({
      to: "5511999999999",
      titulo: "   ",
      mensagem: "Mensagem",
    }),
    /titulo é obrigatório/,
  );
  assert.throws(
    () => prepararDadosNotification({
      to: "5511999999999",
      titulo: "Título",
      mensagem: "Mensagem",
      data: new Date("inválida"),
    }),
    /data deve ser uma data válida/,
  );
});
