import assert from "node:assert/strict";
import test from "node:test";
import { aplicarEdicaoPedidoFila, montarEdicaoPedidoFila, pedidoFornecedorEditavelSchema } from "../src/lib/pedido-fornecedor-edicao";
import { montarDadosPedidoFila } from "../src/lib/pedido-fornecedor-queue";

const tecido = { id: "tecido", nome: "Oxford", referencia: null };
const outro = { id: "outro", nome: "Cetim", referencia: "456" };
const original = { ...montarDadosPedidoFila([{ produtoId: "produto", sku: "EST/123-A/", quantidadeSolicitada: 2, tipoCorte: "LASER" }], [{ produtoId: "produto", quantidadeUsada: 1.5, produtoFornecedor: tecido }]), observacao: "Original" };

test("aplica edição de todos os campos comerciais sem alterar a origem nem os identificadores", () => {
  const antes = JSON.stringify(original);
  const edicao = montarEdicaoPedidoFila(original);
  Object.assign(edicao.itens[0], { tecidoId: outro.id, quantidade: 7, quantidadeTecido: 10.1234567, estampa: "456", variante: "B", tamanho: "100x100", tipoProduto: "Toalha", corteLaser: false });
  edicao.observacao = "Observação editada";
  const resultado = aplicarEdicaoPedidoFila(original, pedidoFornecedorEditavelSchema.parse(edicao), [tecido, outro]);
  assert.deepEqual(resultado.itens[0], { ...original.itens[0], tecido: outro, quantidade: 7, quantidadeTecido: 10.123457, estampa: "456", variante: "B", tamanho: "100x100", tipoProduto: "Toalha", corteLaser: false });
  assert.equal(resultado.observacao, "Observação editada");
  assert.equal(JSON.stringify(original), antes);
});

test("bloqueia tecido externo, troca de produto, remoção e inserção de itens", () => {
  const edicao = montarEdicaoPedidoFila(original);
  assert.throws(() => aplicarEdicaoPedidoFila(original, edicao, []), /tecido cadastrado/);
  assert.throws(() => aplicarEdicaoPedidoFila(original, { ...edicao, itens: [] }, [tecido]), /itens/);
  assert.throws(() => aplicarEdicaoPedidoFila(original, { ...edicao, itens: [...edicao.itens, ...edicao.itens] }, [tecido]), /itens/);
  assert.throws(() => aplicarEdicaoPedidoFila(original, { ...edicao, itens: [{ ...edicao.itens[0], produtoId: "externo" }] }, [tecido]), /produtos/);
});

test("valida quantidades, textos, booleanos e impede campos extras", () => {
  const edicao = montarEdicaoPedidoFila(original);
  for (const patch of [{ quantidade: 0 }, { quantidade: 1.5 }, { quantidadeTecido: -1 }, { quantidadeTecido: Infinity }, { corteLaser: "true" }, { estampa: "x".repeat(501) }, { sku: "FORJADO" }]) {
    assert.equal(pedidoFornecedorEditavelSchema.safeParse({ ...edicao, itens: [{ ...edicao.itens[0], ...patch }] }).success, false);
  }
  assert.equal(pedidoFornecedorEditavelSchema.safeParse({ ...edicao, observacao: "x".repeat(5001) }).success, false);
  const semVariante = aplicarEdicaoPedidoFila(original, { ...edicao, itens: [{ ...edicao.itens[0], variante: "" }] }, [tecido]);
  assert.equal(semVariante.itens[0].variante, null);
});
