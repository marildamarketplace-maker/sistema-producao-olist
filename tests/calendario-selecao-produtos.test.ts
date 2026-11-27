import assert from "node:assert/strict";
import test from "node:test";
import { selecionarPagina, type SelecaoProdutos } from "../src/lib/calendario-comercial/selecao-produtos";
const produto = (id: string, associado = false, ativo = true) => ({ id, sku: id, titulo: id, associado, ativo });

test("seleciona página preservando outros filtros e sem duplicar vínculos existentes", () => {
  const fora = produto("fora");
  const anterior = { fora: { produto: fora, selecionado: true } };
  const proximo = selecionarPagina(anterior, [produto("novo"), produto("vinculado", true)], true);
  assert.deepEqual(Object.keys(proximo), ["fora", "novo"]);
  assert.deepEqual(Object.keys(anterior), ["fora"]);
  assert.deepEqual(selecionarPagina(proximo, [produto("novo")], false), anterior);
});
test("permite remover inativos mas não restaurar associação inativa em lote", () => {
  const inativo = produto("inativo", true, false);
  const removido = selecionarPagina({}, [inativo], false);
  assert.equal(removido.inativo.selecionado, false);
  assert.deepEqual(selecionarPagina(removido, [inativo], true), removido);
  assert.deepEqual(selecionarPagina({}, [produto("inativo", false, false)], true), {});
});
test("limite de 100 é atômico e aceita desfazer alterações no limite", () => {
  const anterior: SelecaoProdutos = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
    const p = produto(String(i)); return [p.id, { produto: p, selecionado: true }];
  }));
  assert.throws(() => selecionarPagina(anterior, [produto("extra")], true), /100 alterações/);
  assert.equal(Object.keys(anterior).length, 100);
  assert.equal(Object.keys(selecionarPagina(anterior, [produto("0")], false)).length, 99);
  assert.deepEqual(selecionarPagina({}, [], true), {});
});
