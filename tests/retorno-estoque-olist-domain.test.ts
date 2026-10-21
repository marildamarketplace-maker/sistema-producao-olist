import assert from "node:assert/strict";
import test from "node:test";
import {
  buscaRetornoSchema, confirmarRetornoSchema, normalizarItensRetorno, revisarBaixaRetorno, validarPedidoCancelado,
  type BaixaRetorno, type SaidaRetorno,
} from "../src/lib/retorno-estoque-olist-domain";

const id = "10000000-0000-4000-8000-000000000001";
const baixa: BaixaRetorno = { id, aplicativoId: "app", produtoId: "produto", sku: "SKU", quantidade: 5,
  pedidoOlistId: "123", movimentacaoId: "saida", retornos: [] };
const saida: SaidaRetorno = { id: "saida", aplicativoId: "app", produtoId: "produto", sku: "SKU", quantidade: 5, tipoMovimento: "saida" };

test("saldo considera retorno parcial e integral sem modificar a baixa", () => {
  assert.equal(revisarBaixaRetorno(baixa, saida, "app").saldo, 5);
  assert.equal(revisarBaixaRetorno({ ...baixa, retornos: [{ quantidade: 2 }] }, saida, "app").saldo, 3);
  assert.equal(revisarBaixaRetorno({ ...baixa, retornos: [{ quantidade: 2 }, { quantidade: 3 }] }, saida, "app").saldo, 0);
  assert.equal(baixa.quantidade, 5);
});

test("baixa exige saída confiável, produto, SKU, pedido e aplicativo", () => {
  for (const alteracao of [{ aplicativoId: "outro" }, { produtoId: null }, { pedidoOlistId: null }, { sku: "" }, { quantidade: 0 }]) {
    assert.throws(() => revisarBaixaRetorno({ ...baixa, ...alteracao }, saida, "app"));
  }
  for (const alteracao of [{ aplicativoId: "outro" }, { produtoId: "outro" }, { sku: "outro" }, { quantidade: 4 }, { tipoMovimento: "entrada" }]) {
    assert.throws(() => revisarBaixaRetorno(baixa, { ...saida, ...alteracao }, "app"));
  }
  assert.throws(() => revisarBaixaRetorno(baixa, undefined, "app"));
  assert.throws(() => revisarBaixaRetorno({ ...baixa, retornos: [{ quantidade: 6 }] }, saida, "app"));
});

test("data deve existir no calendário", () => {
  assert.equal(buscaRetornoSchema.safeParse({ data_atualizacao: "2026-02-29" }).success, false);
  assert.equal(buscaRetornoSchema.safeParse({ data_atualizacao: "2026-10-20" }).success, true);
  assert.equal(buscaRetornoSchema.safeParse({ data_atualizacao: "ontem" }).success, false);
});

test("contrato rejeita quantidades inválidas, seleção vazia, IDs inválidos e campos injetados", () => {
  const payload = { chave_idempotencia: id, itens: [{ item_baixa_id: id, quantidade: 2 }] };
  for (const quantidade of [-1, 1.5, NaN, Infinity, "2", 2147483648]) {
    assert.equal(confirmarRetornoSchema.safeParse({ ...payload, itens: [{ item_baixa_id: id, quantidade }] }).success, false);
  }
  assert.equal(confirmarRetornoSchema.safeParse({ ...payload, itens: [] }).success, false);
  assert.equal(confirmarRetornoSchema.safeParse({ ...payload, aplicativo_id: id }).success, false);
  assert.equal(confirmarRetornoSchema.safeParse({ ...payload, itens: [{ ...payload.itens[0], sku: "INJETADO" }] }).success, false);
  assert.equal(confirmarRetornoSchema.safeParse({ ...payload, chave_idempotencia: "abc" }).success, false);
  assert.throws(() => normalizarItensRetorno({ ...payload, itens: [payload.itens[0], payload.itens[0]] }));
  assert.throws(() => normalizarItensRetorno({ ...payload, itens: [{ item_baixa_id: id, quantidade: 0 }] }));
  assert.equal(normalizarItensRetorno({ ...payload, itens: [...payload.itens, { item_baixa_id: "20000000-0000-4000-8000-000000000001", quantidade: 0 }] }).length, 1);
});

test("confirma cancelamento e correspondência literal dos SKUs vendidos", () => {
  const detalhe = { situacao: 2, itens: [{ produto: { sku: "SKU" } }, { produto: { sku: "SKU-2" } }] };
  validarPedidoCancelado(detalhe, ["SKU", "SKU-2"]);
  for (const situacao of [undefined, null, "Cancelado", 6, {}]) {
    assert.throws(() => validarPedidoCancelado({ ...detalhe, situacao }, ["SKU"]));
  }
  assert.throws(() => validarPedidoCancelado(detalhe, ["SKU-3"]));
});

test("IDs UUID são canônicos e variações de caixa não permitem duplicar a baixa", () => {
  const uuid = "abcdef00-0000-4000-8000-000000000001";
  const input = confirmarRetornoSchema.parse({ chave_idempotencia: uuid.toUpperCase(), itens: [
    { item_baixa_id: uuid, quantidade: 1 }, { item_baixa_id: uuid.toUpperCase(), quantidade: 1 },
  ] });
  assert.equal(input.chave_idempotencia, uuid);
  assert.throws(() => normalizarItensRetorno(input), /repetida/);
});
