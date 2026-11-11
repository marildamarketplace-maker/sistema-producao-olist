import test from "node:test";
import assert from "node:assert/strict";
import { prepararTrocaSkuBaixa } from "../src/lib/baixa-estoque-troca-sku";

const exemplos = [
  { pedidoOlistId: "384818122", skuOrigem: "KIT1-FORRINHO-MV20170-E", sku: "KIT1-FORRINHO-MV20170-D" },
  { pedidoOlistId: "384849041", skuOrigem: "TP/LENCO-MODA-AFRO-C/LASER-TA/70X70-EST/6921-E", sku: "TP/LENCO-MODA-AFRO-C/LASER-TA/70X70-EST/6921-F" },
];

test("troca mantém origem, vínculo e observação, normalizando espaços", () => {
  const item = prepararTrocaSkuBaixa({ ...exemplos[0], sku: ` ${exemplos[0].sku} `, itemOlistId: "item", observacao: "Solicitado pelo cliente" });
  assert.equal(item.sku, exemplos[0].sku);
  assert.equal(item.skuOrigem, exemplos[0].skuOrigem);
  assert.equal(item.itemOlistId, "item");
  assert.match(item.observacao!, /Solicitado pelo cliente.*Troca de SKU/);
  assert.equal(prepararTrocaSkuBaixa({ sku: " SKU " }).skuOrigem, "SKU");
  for (const item of [{ sku: "" }, { sku: "A".repeat(256) }, { sku: "B", skuOrigem: "A" }]) {
    assert.throws(() => prepararTrocaSkuBaixa(item));
  }
});

test("confirmação troca somente a saída, preserva SKU vendido e bloqueia duplicidade ou destino indisponível", async () => {
  type Registro = { sku: string; quantidade: number; skuOrigem?: string; pedidoOlistId?: string; itemOlistId?: string; observacao?: string };
  const movimentos: Registro[] = [], registros: Registro[] = [];
  let indisponivel = false, duplicado = false, duplicadoTransacao = false, associado = false;
  const tx = {
    componenteKitEstoque: { findMany: async () => associado ? [{ kitSku: exemplos[0].sku, sku: "COMPONENTE", quantidade: 2 }] : [] },
    produto: { findMany: async ({ where }: { where: { aplicativoId: string; ativo?: boolean } }) => {
      assert.equal(where.aplicativoId, "app");
      if (where.ativo && indisponivel) return [];
      return [...exemplos.map((item, index) => ({ id: `produto-${index}`, sku: item.sku })), { id: "componente", sku: "COMPONENTE" }];
    }, createMany: async () => assert.fail("Troca não cadastra SKU inexistente") },
    itemBaixaEstoqueOlist: {
      findMany: async () => duplicado ? [{ pedidoOlistId: exemplos[0].pedidoOlistId, itemOlistId: "item-0" }] : [],
      count: async () => duplicadoTransacao ? 1 : 0,
      create: async ({ data }: { data: Registro }) => { registros.push(data); },
    },
    baixaEstoqueOlist: { create: async () => ({ id: "baixa" }) },
    movimentacaoEstoque: { create: async ({ data }: { data: Registro }) => { movimentos.push(data); return { id: "movimento" }; } },
    $queryRaw: async () => [],
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } });
  const { confirmarBaixaEstoqueOlist } = await import("../src/lib/olist");
  const itens = exemplos.map((item, index) => ({ ...item, quantidade: 3, itemOlistId: `item-${index}` }));
  const input = { aplicativoId: "app", origem: "manual" as const, itens };
  await confirmarBaixaEstoqueOlist(input);
  assert.deepEqual(movimentos.map((item) => [item.sku, item.quantidade]), exemplos.map((item) => [item.sku, 3]));
  assert.deepEqual(registros.map((item) => [item.skuOrigem, item.pedidoOlistId, item.itemOlistId]), exemplos.map((item, index) => [item.skuOrigem, item.pedidoOlistId, `item-${index}`]));
  assert.ok(registros.every((item) => item.observacao?.includes("Troca de SKU")));
  movimentos.length = 0; registros.length = 0;
  indisponivel = true;
  await assert.rejects(confirmarBaixaEstoqueOlist(input), /não está ativo neste aplicativo/);
  indisponivel = false; duplicado = true;
  await assert.rejects(confirmarBaixaEstoqueOlist(input), /duplicada/);
  duplicado = false; duplicadoTransacao = true;
  await assert.rejects(confirmarBaixaEstoqueOlist(input), /duplicada/);
  assert.equal(movimentos.length, 0); assert.equal(registros.length, 0);
  duplicadoTransacao = false; associado = true;
  await confirmarBaixaEstoqueOlist({ ...input, itens: [itens[0]] });
  assert.equal(movimentos[0].sku, "COMPONENTE");
  assert.equal(movimentos[0].quantidade, 6);
  assert.equal(registros[0].skuOrigem, exemplos[0].skuOrigem);
});
