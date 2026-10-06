import assert from "node:assert/strict";
import test from "node:test";
import {
  criarAlertaConfirmacaoEntregaProducao,
  criarAlertaErroConfirmacaoEntregaProducao,
  obterLimiteConfirmacao,
} from "../src/lib/confirmacao-entrega-producao";

test("calcula o limite estrito de 24 horas para cobrar confirmação", () => {
  assert.equal(
    obterLimiteConfirmacao(new Date("2026-10-03T19:00:00.000Z")).toISOString(),
    "2026-10-02T19:00:00.000Z",
  );
});

test("monta um alerta para uma confirmação atrasada", () => {
  const alerta = criarAlertaConfirmacaoEntregaProducao({
    agora: new Date("2026-10-04T19:00:00.000Z"),
    urlConfirmacao: "https://producao.example/confirmar-producao",
    producao: {
      id: "producao-1",
      createdAt: new Date("2026-10-01T18:00:00.000Z"),
      dataEntrega: new Date("2026-10-06T00:00:00.000Z"),
      prioridadeProducao: true,
      quantidadeItens: 3,
      quantidadeUnidades: 12,
    },
  });

  assert.equal(alerta.titulo, "Confirmação de entrega de produção pendente");
  assert.match(alerta.mensagem, /mais de 24 horas/);
  assert.match(alerta.mensagem, /PRODUÇÃO PRIORITÁRIA/);
  assert.match(alerta.mensagem, /Entrega: \*06\/10\/2026\*/);
  assert.match(alerta.mensagem, /Criada há: \*3 dias\*/);
  assert.match(alerta.mensagem, /3 item\(ns\) \/ 12 unidades/);
  assert.doesNotMatch(alerta.mensagem, /produções/);
  assert.match(alerta.mensagem, /https:\/\/producao\.example\/confirmar-producao/);
});

test("monta alerta de falha sem expor stack trace", () => {
  const alerta = criarAlertaErroConfirmacaoEntregaProducao({
    error: new Error("Banco indisponível"),
    aplicativoId: "aplicativo-1",
    ocorridoEm: new Date("2026-10-03T19:00:00.000Z"),
  });

  assert.match(alerta.mensagem, /CONFIRMACAO_ENTREGA_PRODUCAO falhou/);
  assert.match(alerta.mensagem, /Aplicativo: aplicativo-1/);
  assert.match(alerta.mensagem, /Detalhe: Banco indisponível/);
  assert.doesNotMatch(alerta.mensagem, /at .*\.ts:/);
});
