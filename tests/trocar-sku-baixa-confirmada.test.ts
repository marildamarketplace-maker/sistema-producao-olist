import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { trocarSkuBaixaConfirmada, trocaBaixaConfirmadaSchema } from "../src/lib/trocar-sku-baixa-confirmada";

function ambiente() {
  let baixa = { id: "baixa-item", aplicativoId: "app", baixaId: "baixa", sku: "KIT1-FORRINHO-MV20170-E", skuOrigem: null as string | null,
    produtoId: "original", movimentacaoId: "saida-original", quantidade: 2, pedidoOlistId: "384818122", itemOlistId: "item", observacao: "Cliente pediu troca", retornos: [] as { id: string }[] };
  let movimentos: { id: string; tipoMovimento: string; sku: string; quantidade: number; observacao: string }[] = [];
  let falhar = false, ausente = false, ativo = true, composicao = 0, consistente = true;
  const locks: string[] = [];
  const db = {
    $queryRaw: async (sql: unknown) => { locks.push(Array.isArray(sql) ? sql.join("?") : (sql as { sql: string }).sql); },
    itemBaixaEstoqueOlist: {
      findFirst: async ({ where }: { where: { aplicativoId: string } }) => !ausente && where.aplicativoId === baixa.aplicativoId ? baixa : null,
      update: async ({ data }: { data: Partial<typeof baixa> }) => { if (falhar) throw new Error("falha de gravação"); baixa = { ...baixa, ...data }; return baixa; },
    },
    produto: { findFirst: async ({ where }: { where: { aplicativoId: string } }) => ativo && where.aplicativoId === "app" ? { id: "novo", sku: "KIT1-FORRINHO-MV20170-D" } : null },
    componenteKitEstoque: { count: async () => composicao },
    movimentacaoEstoque: {
      findFirst: async () => ({ id: baixa.movimentacaoId, sku: baixa.sku, produtoId: baixa.produtoId, quantidade: consistente ? 2 : 3, tipoMovimento: "saida" }),
      create: async ({ data }: { data: Omit<typeof movimentos[number], "id"> }) => { const novo = { id: `mov-${movimentos.length}`, ...data }; movimentos.push(novo); return novo; },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ baixa, movimentos });
      try { return await fn(db); } catch (error) { baixa = snapshot.baixa; movimentos = snapshot.movimentos; throw error; }
    },
  };
  const input = { item_baixa_id: baixa.id, movimentacao_id: baixa.movimentacaoId, sku_anterior: baixa.sku, sku: "KIT1-FORRINHO-MV20170-D" };
  return { db: db as unknown as PrismaClient, input, locks, get baixa() { return baixa; }, get movimentos() { return movimentos; },
    falhar: () => { falhar = true; }, ausente: () => { ausente = true; }, inativo: () => { ativo = false; },
    kit: () => { composicao = 1; }, inconsistente: () => { consistente = false; }, retorno: () => { baixa.retornos.push({ id: "retorno" }); } };
}

test("troca confirmada compensa estoque, preserva vínculo e origem e rejeita reenvio", async () => {
  const a = ambiente();
  await trocarSkuBaixaConfirmada(a.db, "app", "usuario", a.input);
  assert.deepEqual(a.movimentos.map((m) => [m.tipoMovimento, m.sku, m.quantidade]), [["entrada", a.input.sku_anterior, 2], ["saida", a.input.sku, 2]]);
  assert.equal(a.baixa.skuOrigem, a.input.sku_anterior);
  assert.equal(a.baixa.sku, a.input.sku);
  assert.equal(a.baixa.pedidoOlistId, "384818122");
  assert.equal(a.baixa.itemOlistId, "item");
  assert.equal(a.baixa.movimentacaoId, a.movimentos[1].id);
  assert.match(a.baixa.observacao, /Cliente pediu troca.*Responsável: usuario/);
  assert.match(a.locks[0], /pg_advisory_xact_lock/);
  assert.match(a.locks[1], /FOR UPDATE/);
  await assert.rejects(trocarSkuBaixaConfirmada(a.db, "app", "usuario", a.input), /já foi alterada/);
  assert.equal(a.movimentos.length, 2);
});

test("falhas e conflitos não deixam compensação parcial nem alteram baixa", async () => {
  for (const configurar of ["falhar", "ausente", "inativo", "kit", "inconsistente", "retorno"] as const) {
    const a = ambiente(); a[configurar]();
    await assert.rejects(trocarSkuBaixaConfirmada(a.db, "app", "usuario", a.input));
    assert.equal(a.movimentos.length, 0);
    assert.equal(a.baixa.sku, a.input.sku_anterior);
  }
  const a = ambiente();
  await assert.rejects(trocarSkuBaixaConfirmada(a.db, "outro-app", "usuario", a.input), /não encontrada/);
  await assert.rejects(trocarSkuBaixaConfirmada(a.db, "app", "usuario", { ...a.input, sku: a.input.sku_anterior }), /diferente/);
  assert.equal(a.movimentos.length, 0);
});

test("contrato exige IDs válidos, SKU limitado e rejeita campos extras", () => {
  const input = { item_baixa_id: "10000000-0000-4000-8000-000000000001", movimentacao_id: "20000000-0000-4000-8000-000000000001", sku_anterior: "A", sku: "B" };
  assert.equal(trocaBaixaConfirmadaSchema.safeParse(input).success, true);
  for (const patch of [{ sku: " " }, { sku: "A".repeat(256) }, { item_baixa_id: "invalido" }, { aplicativoId: "outro" }]) {
    assert.equal(trocaBaixaConfirmadaSchema.safeParse({ ...input, ...patch }).success, false);
  }
});
