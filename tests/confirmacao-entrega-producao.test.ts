import assert from "node:assert/strict";
import test from "node:test";
import {
  criarAlertaConfirmacaoEntregaProducao,
  criarAlertaErroConfirmacaoEntregaProducao,
  obterLimiteConfirmacao,
} from "../src/lib/confirmacao-entrega-producao";

test("calcula o limite estrito de 48 horas para cobrar confirmação", () => {
  assert.equal(
    obterLimiteConfirmacao(new Date("2026-10-03T19:00:00.000Z")).toISOString(),
    "2026-10-01T19:00:00.000Z",
  );
});

test("monta alerta com resumo das confirmações atrasadas", () => {
  const alerta = criarAlertaConfirmacaoEntregaProducao({
    agora: new Date("2026-10-04T19:00:00.000Z"),
    urlConfirmacao: "https://producao.example/confirmar-producao",
    producoes: [
      {
        id: "producao-1",
        createdAt: new Date("2026-10-01T18:00:00.000Z"),
        dataEntrega: new Date("2026-10-06T00:00:00.000Z"),
        prioridadeProducao: true,
        quantidadeItens: 3,
        quantidadeUnidades: 12,
      },
      {
        id: "producao-2",
        createdAt: new Date("2026-10-02T17:00:00.000Z"),
        dataEntrega: new Date("2026-10-07T00:00:00.000Z"),
        prioridadeProducao: false,
        quantidadeItens: 2,
        quantidadeUnidades: 5,
      },
    ],
  });

  assert.equal(alerta.titulo, "Confirmação de entrega de produção pendente");
  assert.match(alerta.mensagem, /2 produções/);
  assert.match(alerta.mensagem, /1 prioritárias/);
  assert.match(alerta.mensagem, /5 itens \/ 17 unidades/);
  assert.match(alerta.mensagem, /Entrega 06\/10\/2026/);
  assert.match(alerta.mensagem, /criada há 3 dias/);
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
