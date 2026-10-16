import assert from "node:assert/strict";
import test from "node:test";
import { montarDadosPedidoFila } from "../src/lib/pedido-fornecedor-queue";

const item = { produtoId: "produto", sku: "TP/TOALHA-C/OXFORD-EST/6861-A/TP-TA/145X180", quantidadeSolicitada: 3, tipoCorte: "LASER" };
const associacao = { produtoId: "produto", quantidadeUsada: "1.8", produtoFornecedor: { id: "tecido", nome: "Oxford", referencia: "123" } };

test("snapshot preserva SKU, tecido, quantidade em unidades e consumo em metros", () => {
  const dados = montarDadosPedidoFila([item], [associacao]);
  assert.equal(dados.versao, 1);
  assert.deepEqual(dados.itens[0], {
    produtoId: "produto", sku: item.sku, tecido: associacao.produtoFornecedor,
    quantidade: 3, unidade: "UN", quantidadeTecido: 5.4, unidadeTecido: "MT",
    estampa: "6861", variante: "A", corteLaser: true, tamanho: "145x180", tipoProduto: "TOALHA",
  });
});

test("estampa sem variante e corte comum não inventam valores", () => {
  const dados = montarDadosPedidoFila([{ ...item, sku: "EST/6861/", tipoCorte: null }], [associacao]);
  assert.equal(dados.itens[0].estampa, "6861");
  assert.equal(dados.itens[0].variante, null);
  assert.equal(dados.itens[0].corteLaser, false);
});

test("bloqueia pedido vazio, tecido ausente e quantidades inválidas", () => {
  assert.throws(() => montarDadosPedidoFila([], []), /não possui/);
  assert.throws(() => montarDadosPedidoFila([item], []), /sem tecido/);
  for (const consumo of [0, -1, NaN, Infinity, "abc"]) {
    assert.throws(() => montarDadosPedidoFila([item], [{ ...associacao, quantidadeUsada: consumo }]), /inválido/);
  }
  for (const quantidade of [0, -1, 1.5, Infinity]) {
    assert.throws(() => montarDadosPedidoFila([{ ...item, quantidadeSolicitada: quantidade }], [associacao]), /inválido/);
  }
});
