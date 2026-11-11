import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dataHistorico, HistoricoExecucao, type ExecucaoHistorico } from "../src/components/automatizacao/historico-execucao";

const item: ExecucaoHistorico = {
  id: "execucao", status: "FALHA_FINAL", tipo: "EXECUTAR_PROMPT", previstoEm: "2026-11-11T12:00:00Z",
  rotina: { nome: "Rotina de avaliações com nome extenso para conferência do histórico" }, versao: { numero: 2 },
  tentativas: [{ iniciadaEm: "2026-11-11T12:01:00Z", encerradaEm: "2026-11-11T12:02:00Z", status: "FALHA_FINAL",
    resultado: '<script>alert("xss")</script>\nFalha recuperável.',
    avisos: [{ notification: { id: "aviso", status: "ERRO" } }],
  }],
};
const renderizar = (podeIntervir = false, ocupado = false, execucao = item) => renderToStaticMarkup(React.createElement(HistoricoExecucao, {
  item: execucao, podeIntervir, ocupado, onRetentar: () => {},
}));

test("organiza horários, resultado e notificações sem interpretar HTML do resultado", () => {
  const html = renderizar();
  for (const texto of ["Horário previsto", "09:00", "Encerramento", "09:02", "Mais recente", "Resultado da tentativa", "Falha no envio"]) assert.ok(html.includes(texto), texto);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("Retentar execução"));
  assert.ok(!html.includes("Reenviar aviso"));
});

test("preserva permissão, bloqueio durante operações e restrição de retentativa em testes", () => {
  const html = renderizar(true, true);
  assert.match(html, /disabled="">Retentar execução/);
  assert.match(html, /disabled="">Reenviar aviso 1/);
  assert.ok(!renderizar(true, false, { ...item, tipo: "TESTE_ROTINA" }).includes("Retentar execução"));
  assert.ok(!renderizar(true, false, { ...item, status: "CONCLUIDA" }).includes("Retentar execução"));
});

test("execução sem tentativa e dados desconhecidos continuam legíveis", () => {
  const html = renderizar(false, false, { ...item, status: "NOVO_STATUS", tentativas: [] });
  assert.ok(html.includes("Ainda não iniciada"));
  assert.ok(html.includes("NOVO_STATUS"));
  assert.ok(!html.includes("<details"));
  assert.equal(dataHistorico("inválida"), "Data indisponível");
});

test("tentativas mantêm ordem da API e exibem ausência de encerramento e aviso", () => {
  const html = renderizar(false, false, { ...item, tentativas: [
    { ...item.tentativas[0], encerradaEm: null, avisos: [], resultado: null },
    { ...item.tentativas[0], iniciadaEm: "2026-11-11T11:00:00Z" },
  ] });
  assert.ok(html.indexOf("Tentativa 2") < html.indexOf("Tentativa 1"));
  assert.ok(html.includes("Não registrado"));
  assert.ok(html.includes("Não aplicável"));
});
