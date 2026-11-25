import test from "node:test";
import assert from "node:assert/strict";
import { agruparRevisaoPedido, agruparProdutosRevisao } from "../src/lib/revisao-pedido";
import type { ItemPedidoManual } from "../src/lib/pedido-manual-contrato";
const item = (id: string, patch: Partial<ItemPedidoManual> = {}): ItemPedidoManual => ({ id, tecidoNome: "Fourway", modalidade: "PRODUTO_SUBLIMADO", quantidade: 4, quantidadeTecido: 1.4, estampa: "6841", variante: "A", tamanho: "70", tipoProduto: "Lenço", corteLaser: false, ...patch });
test("soma o mesmo produto e tipo preservando variações e laser por linha", () => {
  const itens = [item("a"), item("b", { variante: "B", tamanho: "140", quantidade: 2, quantidadeTecido: 2, corteLaser: true })];
  const grupos = agruparRevisaoPedido(itens, itens.map(i => ({ tecidoId: i.id, id: 5168, preco: 18.99 })));
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].pecas, 6);
  assert.equal(grupos[0].metros, 3.4);
  assert.deepEqual(grupos[0].itens, itens);
});
test("separa tipos, modalidades, preços e produtos distintos", () => {
  const itens = [item("a"), item("b", { tipoProduto: "Pareô" }), item("c", { modalidade: "TECIDO_SUBLIMADO" }), item("d"), item("e")];
  assert.equal(agruparRevisaoPedido(itens, itens.map((i,n) => ({ tecidoId: i.id, id: n===4 ? 6887 : 5168, preco: n===3 ? 20 : 18.99 }))).length, 5);
});
test("tecido corrido soma somente metros", () => {
  const grupos = agruparRevisaoPedido([item("a", { modalidade: "TECIDO_LISO" }), item("b", { modalidade: "TECIDO_LISO" })], []);
  assert.equal(grupos[0].pecas, 0);
  assert.equal(grupos[0].metros, 2.8);
});

test("unifica produto em um card com tipos e preços separados internamente",()=>{
 const itens=[item("a"),item("b",{tipoProduto:"Pareô"}),item("c",{modalidade:"TECIDO_SUBLIMADO",quantidade:0,quantidadeTecido:10}),item("d",{modalidade:"TECIDO_LISO",quantidade:0,quantidadeTecido:5})];
 const cards=agruparProdutosRevisao(itens,itens.map((i,n)=>({tecidoId:i.id,id:5168,preco:n>1?20:18.99})));
 assert.equal(cards.length,1);assert.equal(cards[0].tipos.length,4);assert.equal(cards[0].pecas,8);assert.equal(cards[0].metros,17.8);
 assert.deepEqual(cards[0].tipos.map(t=>t.preco),[18.99,18.99,20,20]);
});
