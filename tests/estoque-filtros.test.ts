import assert from "node:assert/strict";
import test from "node:test";
import { filtrarEstoque, FILTROS_ESTOQUE_INICIAIS, type FiltrosEstoque } from "../src/lib/estoque-filtros";
const linhas = [
  { sku: "ABC-A", saldo_atual: 10, meta_aplicada: 10, qtd_movimentacoes: 2, imagem_url: "imagem.jpg" },
  { sku: "ABC-B", saldo_atual: 0, meta_aplicada: 5, qtd_movimentacoes: 0, imagem_url: null },
  { sku: "XYZ", saldo_atual: -2, meta_aplicada: 0, qtd_movimentacoes: 3, imagem_url: null },
];
const filtrar = (filtros: Partial<FiltrosEstoque>) => filtrarEstoque(linhas, { ...FILTROS_ESTOQUE_INICIAIS, ...filtros }).map((linha) => linha.sku);
test("sem filtros preserva produtos, ordem e dados originais", () => {
  assert.deepEqual(filtrar({}), ["ABC-A", "ABC-B", "XYZ"]);
  assert.equal(filtrarEstoque(linhas, FILTROS_ESTOQUE_INICIAIS)[0], linhas[0]);
});
test("SKU parcial ignora caixa e espaços externos", () => {
  assert.deepEqual(filtrar({ sku: " abc- " }), ["ABC-A", "ABC-B"]);
  assert.deepEqual(filtrar({ sku: "   " }), ["ABC-A", "ABC-B", "XYZ"]);
});
test("separa saldos positivos, zerados e negativos", () => {
  assert.deepEqual(filtrar({ saldo: "positivo" }), ["ABC-A"]);
  assert.deepEqual(filtrar({ saldo: "zero" }), ["ABC-B"]);
  assert.deepEqual(filtrar({ saldo: "negativo" }), ["XYZ"]);
});
test("compara meta aplicada incluindo igualdade e meta zero", () => {
  assert.deepEqual(filtrar({ meta: "abaixo" }), ["ABC-B", "XYZ"]);
  assert.deepEqual(filtrar({ meta: "atingida" }), ["ABC-A"]);
  assert.equal(filtrarEstoque([{ ...linhas[1], meta_aplicada: 0 }], { ...FILTROS_ESTOQUE_INICIAIS, meta: "atingida" }).length, 1);
});
test("filtra presença e ausência de imagem e movimentações", () => {
  assert.deepEqual(filtrar({ imagem: "com" }), ["ABC-A"]);
  assert.deepEqual(filtrar({ imagem: "sem" }), ["ABC-B", "XYZ"]);
  assert.deepEqual(filtrar({ movimentacoes: "com" }), ["ABC-A", "XYZ"]);
  assert.deepEqual(filtrar({ movimentacoes: "sem" }), ["ABC-B"]);
});
test("combina filtros com interseção, aceita resultado vazio e limpeza", () => {
  assert.deepEqual(filtrar({ sku: "abc", meta: "abaixo", imagem: "sem", movimentacoes: "sem", saldo: "zero" }), ["ABC-B"]);
  assert.deepEqual(filtrar({ saldo: "negativo", imagem: "com" }), []);
  assert.deepEqual(filtrarEstoque([], FILTROS_ESTOQUE_INICIAIS), []);
  assert.equal(filtrar({}).length, 3);
});
