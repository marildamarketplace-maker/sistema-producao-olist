import assert from "node:assert/strict";
import test from "node:test";
import { criarRascunhoFilaOlist, serializarRascunhoFilaOlist, dadosOlistFilaSchema } from "../src/lib/fila-olist-contrato";
import { dadosPedidoFilaSchema } from "../src/lib/fila-fornecedor-contrato";
const tecido = "00000000-0000-0000-0000-000000000007";
const filial = "00000000-0000-0000-0000-000000000003";
test("rascunho sem JSON deixa selects e preços vazios, sem tipo de venda presumido", () => {
  const r = criarRascunhoFilaOlist([tecido, tecido]);
  assert.equal(r.clienteId, 0); assert.equal(r.tipoVenda, ""); assert.equal(r.planoId, ""); assert.equal(r.laser, null);
  assert.deepEqual(r.tecidos, [{ tecidoId: tecido, id: 0, preco: null }]);
  const salvo = JSON.parse(JSON.stringify(serializarRascunhoFilaOlist(r)));
  assert.deepEqual(salvo, { tecidos: [], laser: null });
});
test("restaura apenas campos definidos, preserva preço zero explícito e ignora tecido antigo", () => {
  const r = criarRascunhoFilaOlist([tecido], { clienteId: 123, tecidos: [{ tecidoId: tecido, id: 400, preco: 0 }, { tecidoId: filial, id: 999, preco: 50 }] });
  assert.equal(r.clienteId, 123); assert.equal(r.vendedorId, 0); assert.equal(r.tipoVenda, "");
  assert.deepEqual(r.tecidos, [{ tecidoId: tecido, id: 400, preco: 0 }]);
  assert.equal(serializarRascunhoFilaOlist(r).tecidos?.[0].preco, 0);
});
test("JSON aceita seleções parciais e rejeita conta, preços e planos inválidos", () => {
  assert.equal(dadosOlistFilaSchema.safeParse({ filialId: filial, selecoes: { clienteId: 123 } }).success, true);
  for (const selecoes of [{ clienteId: -1 }, { aplicativoId: filial }, { planoId: filial }, { tecidos: [{ tecidoId: tecido, id: 400, preco: -1 }] }]) {
    assert.equal(dadosOlistFilaSchema.safeParse({ filialId: filial, selecoes }).success, false);
  }
  assert.throws(() => serializarRascunhoFilaOlist({ ...criarRascunhoFilaOlist([tecido]), tecidos: [{ tecidoId: tecido, id: 400, preco: -1 }] }), /Revise/);
});
test("contrato da fila preserva bloco Olist opcional e continua aceitando snapshots anteriores", () => {
  const dados = { versao: 1, itens: [{ produtoId: "produto", sku: "sku", tecido: { id: tecido, nome: "Tecido", referencia: null }, quantidade: 1, unidade: "UN", quantidadeTecido: 2, unidadeTecido: "MT", estampa: "A", variante: null, corteLaser: false, tamanho: "", tipoProduto: "" }] };
  assert.equal(dadosPedidoFilaSchema.safeParse(dados).success, true);
  const olist = { filialId: filial, selecoes: { clienteId: 123 } };
  assert.deepEqual(dadosPedidoFilaSchema.parse({ ...dados, olist }).olist, olist);
});
