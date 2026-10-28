import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

const consultas: Prisma.Sql[] = [];
Object.assign(globalThis, { prisma: {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = Prisma.sql(strings, ...values);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)") ? [{ total: BigInt(7) }] : []);
  },
  $transaction: (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
} });

test("filtros combinados usam parâmetros e afetam listagem e contagem antes da paginação", async () => {
  const { listarEstampaJobsPainel } = await import("../src/repositories/estampa-jobs-repository");
  const resultado = await listarEstampaJobsPainel({ codigo: " 123%_ ", variante: " a ", status: "FAILED", limite: 20, offset: 40 });
  assert.equal(resultado.total, 7);
  for (const consulta of consultas) {
    assert.match(consulta.sql, /INNER JOIN estampas AS catalogo/);
    assert.match(consulta.sql, /strpos\(upper\(catalogo.codigo\)/);
    assert.match(consulta.sql, /upper\(btrim\(catalogo.variante\)\)/);
    assert.ok(consulta.values.includes("123%_"));
    assert.ok(consulta.values.includes("a"));
    assert.ok(consulta.values.includes("FAILED"));
    assert.doesNotMatch(consulta.sql, /123%_/);
  }
  assert.deepEqual(consultas[0].values.slice(-2), [20, 40]);
});

test("sem filtros preserva a listagem e rejeita termos excessivos", async () => {
  const { listarEstampaJobsPainel } = await import("../src/repositories/estampa-jobs-repository");
  consultas.length = 0;
  await listarEstampaJobsPainel({ codigo: " ", variante: " " });
  assert.doesNotMatch(consultas[0].sql, /strpos/);
  await assert.rejects(listarEstampaJobsPainel({ codigo: "a".repeat(101) }), /100 caracteres/);
  await assert.rejects(listarEstampaJobsPainel({ variante: "a".repeat(101) }), /100 caracteres/);
});
