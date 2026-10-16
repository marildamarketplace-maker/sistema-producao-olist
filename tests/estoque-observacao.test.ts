import assert from "node:assert/strict";
import test from "node:test";
import { observacaoMovimentacaoEstoque } from "../src/lib/estoque-observacao";

const movimento = {
  tipoMovimento: "entrada", origem: "PRODUCAO", referenciaId: "pedido-1",
  observacao: "Entrada por confirmação de produção",
};

test("concatena a confirmação antes da observação literal do pedido vinculado", () => {
  const observacao = "  Pedido especial\nEntregar à tarde  ";
  assert.equal(observacaoMovimentacaoEstoque(movimento, new Map([["pedido-1", observacao]])), `${movimento.observacao} - ${observacao}`);
});

test("sem observação da confirmação exibe apenas a do pedido, sem separador", () => {
  const observacoes = new Map([["pedido-1", "Pedido especial"]]);
  for (const observacao of [null, "", "  "]) {
    assert.equal(observacaoMovimentacaoEstoque({ ...movimento, observacao }, observacoes), "Pedido especial");
  }
});

test("mantém a observação original quando pedido ou observação não estão disponíveis", () => {
  for (const observacao of [null, "", "  "]) {
    assert.equal(observacaoMovimentacaoEstoque(movimento, new Map([["pedido-1", observacao]])), movimento.observacao);
  }
  assert.equal(observacaoMovimentacaoEstoque(movimento, new Map()), movimento.observacao);
  assert.equal(observacaoMovimentacaoEstoque({ ...movimento, referenciaId: null }, new Map()), movimento.observacao);
});

test("preserva saídas e entradas de outras origens", () => {
  const observacoes = new Map([["pedido-1", "Observação do pedido"]]);
  for (const alteracao of [{ tipoMovimento: "saida" }, { origem: "MANUAL" }]) {
    assert.equal(observacaoMovimentacaoEstoque({ ...movimento, ...alteracao }, observacoes), movimento.observacao);
  }
});
