import test from "node:test";
import assert from "node:assert/strict";

const kit = "KIT2-AFRO-2/70X70-6921-H-1/150X150-6921-D";
const lenco = "TP/LENCO-EST/6921-H";
const pareo = "TP/PAREO-EST/6921-D";

test("baixa infere sem gravar composição, preserva origem e revalida antes das escritas", async () => {
  let dentroTransacao = false;
  let mudarComposicao = false;
  let explicita = false;
  let consultasAtivos = 0;
  const movimentos: Array<{ sku: string; quantidade: number }> = [];
  const itens: Array<{ skuOrigem: string; pedidoOlistId: string; itemOlistId: string }> = [];
  const tx = {
    componenteKitEstoque: { findMany: async ({ where }: { where: { aplicativoId: string } }) => {
      assert.equal(where.aplicativoId, "app");
      return explicita || (mudarComposicao && dentroTransacao)
        ? [{ kitSku: kit, sku: pareo, quantidade: 4 }] : [];
    } },
    produto: {
      findMany: async ({ where }: { where: { aplicativoId: string; ativo?: boolean } }) => {
        assert.equal(where.aplicativoId, "app");
        if (where.ativo) consultasAtivos++;
        return [{ id: "lenco", sku: lenco }, { id: "pareo", sku: pareo }];
      },
      createMany: async () => { assert.fail("não deve cadastrar produtos inferidos"); },
    },
    itemBaixaEstoqueOlist: {
      findMany: async () => [], count: async () => 0,
      create: async ({ data }: { data: typeof itens[number] }) => { itens.push(data); },
    },
    baixaEstoqueOlist: { create: async () => ({ id: "baixa" }) },
    movimentacaoEstoque: { create: async ({ data }: { data: typeof movimentos[number] }) => {
      movimentos.push(data); return { id: "movimento" };
    } },
    $queryRaw: async () => [],
  };
  Object.assign(globalThis, { prisma: { ...tx,
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      dentroTransacao = true;
      try { return await callback(tx); } finally { dentroTransacao = false; }
    },
  } });
  const { confirmarBaixaEstoqueOlist } = await import("../src/lib/olist");
  const input = { aplicativoId: "app", origem: "automatica" as const,
    itens: [{ sku: kit, quantidade: 3, pedidoOlistId: "pedido", itemOlistId: "original" }],
  };
  assert.deepEqual(await confirmarBaixaEstoqueOlist(input), { baixa_id: "baixa", itens: 1 });
  assert.deepEqual(movimentos.map(({ sku, quantidade }) => ({ sku, quantidade })), [
    { sku: lenco, quantidade: 6 }, { sku: pareo, quantidade: 3 },
  ]);
  assert.equal(consultasAtivos, 2);
  assert.ok(itens.every((item) => item.skuOrigem === kit && item.pedidoOlistId === "pedido" && item.itemOlistId === "original"));
  movimentos.length = 0; itens.length = 0;
  mudarComposicao = true;
  await assert.rejects(confirmarBaixaEstoqueOlist(input), /Composição do kit alterada/);
  assert.equal(movimentos.length, 0);
  assert.equal(itens.length, 0);
  explicita = true; consultasAtivos = 0;
  await confirmarBaixaEstoqueOlist(input);
  assert.equal(consultasAtivos, 0);
  assert.equal(movimentos.length, 1);
  assert.equal(movimentos[0].sku, pareo);
  assert.equal(movimentos[0].quantidade, 12);
});
