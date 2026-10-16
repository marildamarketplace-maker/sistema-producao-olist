import test from "node:test";
import assert from "node:assert/strict";
import { montarPedidoFornecedor, type LinhaFornecedor } from "../src/lib/pedido-fornecedor-montagem";
import { selecoesFilaOlistSchema } from "../src/lib/fila-olist-contrato";
const config = { clienteId: 1, vendedorId: 2, formaId: 3, plano: "30/60/90", tipoVenda: "VENDA_G", observacao: "  editada na fila  " };
const linha: LinhaFornecedor = { referencia: "10", nome: "Oxford", preco: 1.01, quantidade: 1, quantidadeSolicitada: 2,
  sku: "SKU-EST/1234-A/", estampa: "1234", variante: "A", laser: false, tamanho: "145x180", tipo: "Toalha" };
test("montagem compartilhada preserva agrupamentos, unidades, tags, laser e centavos das parcelas", () => {
  const pedido = montarPedidoFornecedor([linha, { ...linha, quantidade: 2, quantidadeSolicitada: 4 }, { ...linha, laser: true }], config, { referencia: "20", preco: 0.01 });
  assert.equal(pedido.itens.length, 3);
  assert.deepEqual(pedido.itens.map((i) => [i.produto.id, i.produto.tipo, i.quantidade, i.valorUnitario]), [[10, "P", 3, 1.01], [10, "P", 1, 1.01], [20, "S", 1, 0.01]]);
  assert.match(pedido.itens[0].infoAdicional, /6,00/);
  assert.match(pedido.itens[1].infoAdicional, /2,00/);
  assert.match(pedido.observacoesInternas, /Oxford/);
  assert.equal(pedido.observacoes, "Tipo de venda: VENDA_G\n\nObservação do pedido: editada na fila");
  assert.equal(pedido.situacao, 0);
  assert.deepEqual(pedido.pagamento.parcelas.map((p) => p.valor), [1.35, 1.35, 1.35]);
  assert.deepEqual(pedido.pagamento.parcelas.map((p) => p.dias), [30, 60, 90]);
});
test("parcelas distribuem resto dos centavos, à vista usa zero dias", () => {
  assert.deepEqual(montarPedidoFornecedor([linha], config).pagamento.parcelas.map((p) => p.valor), [0.34, 0.34, 0.33]);
  assert.deepEqual(montarPedidoFornecedor([linha], { ...config, plano: "a vista" }).pagamento.parcelas, [{ dias: 0, valor: 1.01, formaRecebimento: { id: 3 } }]);
});
test("bloqueia quantidade/preço inválidos, conflitos de preço, laser incompleto e planos inválidos", () => {
  for (const quantidade of [0, -1, NaN, Infinity, 0.0001]) assert.throws(() => montarPedidoFornecedor([{ ...linha, quantidade }], config));
  for (const preco of [-1, NaN, Infinity]) assert.throws(() => montarPedidoFornecedor([{ ...linha, preco }], config));
  assert.throws(() => montarPedidoFornecedor([linha, { ...linha, preco: 2 }], config));
  assert.throws(() => montarPedidoFornecedor([{ ...linha, laser: true }], config), /laser/);
  for (const plano of ["", "30/xx", "-1"]) assert.throws(() => montarPedidoFornecedor([linha], { ...config, plano }));
});
test("seleções comerciais bloqueiam payload arbitrário, preços negativos e IDs inválidos", () => {
  assert.equal(selecoesFilaOlistSchema.safeParse({ payload: {} }).success, false);
});
