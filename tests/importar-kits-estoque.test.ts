import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { lerLoteKits, loteKitsSchema, validarLoteKits } from "../src/lib/importar-kits-estoque";
import { importarLoteKits } from "../src/lib/kits-estoque-importacao-service";

test("agrupa kits com BOM, cabeçalho, linhas vazias e quantidade por componente", () => {
  assert.deepEqual(lerLoteKits('\uFEFFsku_kit;sku_componente;quantidade\r\nK1;A;2\r\n\r\nK2;B;1\r\nK1;C;3'), [
    { sku: "K1", componentes: [{ sku: "A", quantidade: 2 }, { sku: "C", quantidade: 3 }] },
    { sku: "K2", componentes: [{ sku: "B", quantidade: 1 }] },
  ]);
});
test("aceita colagem de planilha, CSV com vírgula e campos entre aspas", () => {
  for (const separador of ["\t", ",", ";"]) {
    const lote = lerLoteKits(["sku_kit", "sku_componente", "quantidade"].join(separador) + '\n' + ['" KIT "', '"SKU-1"', '2'].join(separador));
    assert.equal(lote[0].sku, "KIT"); assert.equal(lote[0].componentes[0].quantidade, 2);
  }
  assert.equal(lerLoteKits('"KIT;A";"SKU;1";2')[0].componentes[0].sku, "SKU;1");
});
test("erros informam linha e impedem componentes repetidos, autorreferência ou dados incompletos", () => {
  for (const texto of ["KIT;A;1\nKIT;A;2", "KIT;KIT;1", "KIT;;1", "KIT;A;1;EXTRA", 'KIT;"A;1']) {
    assert.throws(() => lerLoteKits(texto), /Linha \d+/);
  }
  for (const quantidade of ["0", "-1", "1.5", "1,5", "Infinity", "2147483648"]) {
    assert.throws(() => lerLoteKits(`KIT;A;${quantidade}`));
  }
});
test("limita arquivo, kits e componentes e rejeita lote vazio", () => {
  for (const texto of ["", "sku_kit;sku_componente;quantidade", "a".repeat(1_000_001), Array.from({ length: 501 }, (_, i) => `KIT-${i};A;1`).join("\n"), Array.from({ length: 101 }, (_, i) => `KIT;A-${i};1`).join("\n")]) {
    assert.throws(() => lerLoteKits(texto));
  }
  assert.equal(loteKitsSchema.safeParse({ kits: [{ sku: "K", componentes: [] }] }).success, false);
  assert.equal(loteKitsSchema.safeParse({ kits: [1, 2].map(() => ({ sku: "K", componentes: [{ sku: "A", quantidade: 1 }] })) }).success, false);
});
test("valida o grafo final: rejeita kits aninhados no lote e referências de kits existentes", () => {
  assert.throws(() => validarLoteKits(lerLoteKits("K1;K2;1\nK2;A;1"), new Set(["K2", "A"]), []), /também é um kit/);
  assert.throws(() => validarLoteKits(lerLoteKits("K2;A;1"), new Set(["A"]), [{ kitSku: "K1", sku: "K2" }]), /também é um kit/);
  // A composição anterior será substituída inteira e não pode causar falso ciclo.
  assert.doesNotThrow(() => validarLoteKits(lerLoteKits("K1;A;1\nK2;B;1"), new Set(["A", "B"]), [{ kitSku: "K1", sku: "K2" }]));
});

function ambiente(falhar = false) {
  const aplicativoId = "app-atual";
  let linhas = [{ aplicativoId, kitSku: "K1", sku: "ANTIGO", quantidade: 1 },
    { aplicativoId, kitSku: "MANTER", sku: "X", quantidade: 1 },
    { aplicativoId: "outro-app", kitSku: "K1", sku: "OUTRO", quantidade: 1 }];
  let bloqueou = false;
  const tx = {
    $queryRaw: async () => { bloqueou = true; },
    produto: { findMany: async ({ where }: { where: { aplicativoId: string; ativo: boolean } }) => {
      assert.equal(where.aplicativoId, aplicativoId); assert.equal(where.ativo, true);
      return [{ sku: "A" }, { sku: "B" }];
    } },
    componenteKitEstoque: {
      findMany: async ({ where }: { where: { aplicativoId: string } }) => linhas.filter((item) => item.aplicativoId === where.aplicativoId),
      deleteMany: async ({ where }: { where: { aplicativoId: string; kitSku: { in: string[] } } }) => {
        assert.equal(bloqueou, true);
        linhas = linhas.filter((item) => item.aplicativoId !== where.aplicativoId || !where.kitSku.in.includes(item.kitSku));
      },
      createMany: async ({ data }: { data: typeof linhas }) => {
        if (falhar) throw new Error("falha de gravação");
        assert.ok(data.every((item) => item.aplicativoId === aplicativoId)); linhas.push(...data);
      },
    },
  };
  const db = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
    const antes = structuredClone(linhas);
    try { return await fn(tx); } catch (error) { linhas = antes; throw error; }
  } } as unknown as PrismaClient;
  return { db, aplicativoId, get linhas() { return linhas; } };
}
test("substitui o kit inteiro e preserva kits fora do lote e de outros aplicativos", async () => {
  const a = ambiente();
  assert.deepEqual(await importarLoteKits(a.db, a.aplicativoId, { kits: lerLoteKits("K1;A;2\nK2;B;1") }), { kits: 2, componentes: 2 });
  assert.ok(!a.linhas.some((item) => item.sku === "ANTIGO"));
  assert.ok(a.linhas.some((item) => item.kitSku === "MANTER"));
  assert.ok(a.linhas.some((item) => item.sku === "OUTRO"));
});
test("componente ausente/inativo ou falha na gravação não deixa lote parcialmente importado", async () => {
  for (const falhar of [false, true]) {
    const a = ambiente(falhar), antes = structuredClone(a.linhas);
    await assert.rejects(importarLoteKits(a.db, a.aplicativoId, { kits: lerLoteKits(falhar ? "K1;A;2" : "K1;A;2\nK2;INATIVO;1") }));
    assert.deepEqual(a.linhas, antes);
  }
});
test("servidor rejeita lote malformado antes de abrir transação", async () => {
  await assert.rejects(importarLoteKits({} as PrismaClient, "app", { kits: [] }));
});
