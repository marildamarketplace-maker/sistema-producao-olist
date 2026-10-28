import test from "node:test";
import assert from "node:assert/strict";
import { montarOpcoesKitsManuais, expandirKitProducaoManual } from "../src/lib/producao-manual-kits";
const produtos = [{ id: "a", sku: "A", imagem_url: null }, { id: "b", sku: "B", imagem_url: null }];
const composicao = [{ kitSku: "KIT-AB", sku: "A", quantidade: 2 }, { kitSku: "KIT-AB", sku: "B", quantidade: 1 }];
test("kit sem cadastro de produto fica disponível para seleção manual", () => {
  const opcoes = montarOpcoesKitsManuais(produtos, composicao);
  assert.equal(opcoes.length, 3);
  assert.deepEqual(opcoes.find((item) => item.sku === "KIT-AB")?.componentes_kit, [{ sku: "A", quantidade: 2 }, { sku: "B", quantidade: 1 }]);
});
test("kit cadastrado não duplica opções e componentes mantêm IDs reais", () => {
  const opcoes = montarOpcoesKitsManuais([...produtos, { id: "kit", sku: "KIT-AB", imagem_url: null }], composicao);
  assert.equal(opcoes.length, 3);
  const kit = opcoes.find((item) => item.sku === "KIT-AB")!;
  assert.equal(kit.id, "kit");
  const itens = expandirKitProducaoManual(kit, "3", opcoes)!;
  assert.deepEqual(itens.map((item) => [item.produto.id, item.produto.sku, item.quantidade]), [["a", "A", 6], ["b", "B", 3]]);
  assert.equal(itens.some((item) => item.produto.sku === kit.sku), false);
});
test("produtos individuais preservam seleção normal", () => {
  assert.equal(expandirKitProducaoManual(produtos[0], "2", produtos), null);
});
test("componente ausente ou inativo bloqueia expansão completa", () => {
  const opcoes = montarOpcoesKitsManuais(produtos.slice(0, 1), composicao);
  assert.throws(() => expandirKitProducaoManual(opcoes.find((item) => item.sku === "KIT-AB")!, "2", opcoes), /não está disponível/);
});
test("componente que também é kit não vira item individual de produção", () => {
  const opcoes = montarOpcoesKitsManuais(produtos, [...composicao, { kitSku: "A", sku: "B", quantidade: 1 }]);
  assert.throws(() => expandirKitProducaoManual(opcoes.find((item) => item.sku === "KIT-AB")!, "2", opcoes), /não está disponível/);
});
test("quantidade de kits inválida ou com overflow é rejeitada antes de alterar itens", () => {
  const opcoes = montarOpcoesKitsManuais(produtos, composicao), kit = opcoes.find((item) => item.sku === "KIT-AB")!;
  for (const quantidade of ["", "0", "-1", "1.5", "2147483647"]) assert.throws(() => expandirKitProducaoManual(kit, quantidade, opcoes));
});
