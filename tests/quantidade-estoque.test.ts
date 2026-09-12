import assert from "node:assert/strict";
import test from "node:test";
import { QUANTIDADE_ESTOQUE_MAXIMA, quantidadeEstoqueValida } from "../src/lib/quantidade-estoque";

test("aceita somente quantidades inteiras positivas dentro do limite do banco", () => {
  assert.equal(quantidadeEstoqueValida(1), true);
  assert.equal(quantidadeEstoqueValida("12"), true);
  assert.equal(quantidadeEstoqueValida(QUANTIDADE_ESTOQUE_MAXIMA), true);

  assert.equal(quantidadeEstoqueValida(""), false);
  assert.equal(quantidadeEstoqueValida(0), false);
  assert.equal(quantidadeEstoqueValida(-1), false);
  assert.equal(quantidadeEstoqueValida(1.5), false);
  assert.equal(quantidadeEstoqueValida(QUANTIDADE_ESTOQUE_MAXIMA + 1), false);
  assert.equal(quantidadeEstoqueValida(Number.NaN), false);
});
