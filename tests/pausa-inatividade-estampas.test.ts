import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

let inativa = false;
let alteradas = 0;
let transacoes = 0;
let pausado = false;
let comandos: Prisma.Sql[] = [];
let preflight: Prisma.Sql;
let falharLock = false;
const tx = {
  async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = Prisma.sql(strings, ...values);
    comandos.push(sql);
    if (falharLock && sql.sql.includes("LOCK TABLE")) throw new Error("lock timeout");
    return sql.sql.includes("UPDATE configuracoes_jobs") ? alteradas : 0;
  },
};
Object.assign(globalThis, { prisma: {
  configuracaoJob: { findUnique: async () => ({ pausado }) },
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    preflight = Prisma.sql(strings, ...values);
    return [{ inativa }];
  },
  async $transaction(fn: (db: typeof tx) => Promise<boolean>, options: unknown) {
    transacoes++;
    assert.deepEqual(options, { isolationLevel: "ReadCommitted" });
    return fn(tx);
  },
} });

test("atividade recente dispensa transação e bloqueio da fila", async () => {
  const { pausarProcessarEstampasPorInatividade } = await import("../src/repositories/configuracao-jobs-repository");
  assert.equal(await pausarProcessarEstampasPorInatividade(), false);
  assert.equal(transacoes, 0);
  assert.match(preflight.sql, /job.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'/);
  assert.match(preflight.sql, /job.updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'/);
  assert.match(preflight.sql, /job.status = 'PROCESSING'/);
  assert.match(preflight.sql, /job.tipo = 'AI_ANALYSIS'/);
  assert.match(preflight.sql, /updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'/);
  assert.deepEqual(preflight.values, ["processar-estampas"]);
});

test("inatividade pausa atomicamente e revalida os critérios após bloquear escritas", async () => {
  const { pausarProcessarEstampasPorInatividade } = await import("../src/repositories/configuracao-jobs-repository");
  inativa = true; alteradas = 1; comandos = [];
  assert.equal(await pausarProcessarEstampasPorInatividade(), true);
  assert.equal(comandos[0].sql, "SET LOCAL lock_timeout = '1s'");
  assert.equal(comandos[1].sql, "LOCK TABLE estampa_jobs IN SHARE MODE");
  assert.match(comandos[2].sql, /SET pausado = TRUE, updated_at = CURRENT_TIMESTAMP/);
  assert.match(comandos[2].sql, /job.created_at >=/);
  assert.match(comandos[2].sql, /job.updated_at >=/);
  assert.match(comandos[2].sql, /job.status = 'PROCESSING'/);
  assert.match(comandos[2].sql, /AND pausado = FALSE/);
  assert.deepEqual(comandos[2].values, ["processar-estampas"]);
});

test("atividade ou retomada concorrente impede a pausa na segunda verificação", async () => {
  const { pausarProcessarEstampasPorInatividade } = await import("../src/repositories/configuracao-jobs-repository");
  alteradas = 0;
  assert.equal(await pausarProcessarEstampasPorInatividade(), false);
});

test("timeout do lock não executa atualização", async () => {
  const { pausarProcessarEstampasPorInatividade } = await import("../src/repositories/configuracao-jobs-repository");
  falharLock = true; comandos = [];
  await assert.rejects(pausarProcessarEstampasPorInatividade(), /lock timeout/);
  assert.equal(comandos.length, 2);
  falharLock = false;
});

test("cron autentica antes da pausa e dispensa providers quando pausa por inatividade", async () => {
  const { GET } = await import("../src/app/api/cron/processar-estampas/route");
  const original = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "segredo-teste";
    const antes = transacoes;
    assert.equal((await GET(new NextRequest("https://example.com/api/cron/processar-estampas"))).status, 401);
    assert.equal(transacoes, antes);
    inativa = true; alteradas = 1;
    const response = await GET(new NextRequest("https://example.com/api/cron/processar-estampas", {
      headers: { authorization: "Bearer segredo-teste" },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, pausado: true, motivoParada: "inatividade_24h" });
    pausado = true;
    const apos = transacoes;
    await GET(new NextRequest("https://example.com/api/cron/processar-estampas", {
      headers: { authorization: "Bearer segredo-teste" },
    }));
    assert.equal(transacoes, apos);
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
});
