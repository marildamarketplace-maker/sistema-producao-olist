import assert from "node:assert/strict";
import test from "node:test";
import type { EstampaJob } from "@prisma/client";
import { executarEstampasCron, type DependenciasEstampasCron } from "../src/services/estampasCronService";
import { NextRequest } from "next/server";
import { GET, maxDuration } from "../src/app/api/cron/processar-estampas/route";

const job = (id: string) => ({ id }) as EstampaJob;
const opcoes = { prazoMs: 1000, reservaJobMs: 100, maxJobs: 5, concorrencia: 2 };
function deps(overrides: Partial<DependenciasEstampasCron> = {}): DependenciasEstampasCron {
  return { detectar: async () => ({}), recuperar: async () => ({}), assumir: async () => null, processar: async () => "concluido", agora: () => 0, ...overrides };
}
test("fila vazia encerra sem polling, depois de recuperar e detectar", async () => {
  const chamadas: string[] = [];
  const r = await executarEstampasCron(opcoes, deps({
    detectar: async () => { chamadas.push("detectar"); },
    recuperar: async () => { chamadas.push("recuperar"); },
    assumir: async () => { chamadas.push("assumir"); return null; },
  }));
  assert.deepEqual(chamadas, ["recuperar", "detectar", "assumir"]);
  assert.equal(r.motivoParada, "fila_vazia");
});
test("limita quantidade, concorrência e contabiliza resultados", async () => {
  let id = 0, ativos = 0, pico = 0;
  const r = await executarEstampasCron(opcoes, deps({
    assumir: async () => job(String(++id)),
    processar: async j => {
      ativos++; pico = Math.max(pico, ativos);
      await new Promise(resolve => setImmediate(resolve));
      ativos--;
      return j.id === "1" ? "falha" : j.id === "2" ? "ignorado" : j.id === "3" ? "lock_perdido" : "concluido";
    },
  }));
  assert.equal(id, 5); assert.equal(pico, 2);
  assert.equal(r.concluidos, 2); assert.equal(r.ignorados, 1);
  assert.equal(r.falhas, 1); assert.equal(r.locksPerdidos, 1);
  assert.equal(r.motivoParada, "limite_jobs");
});
test("reserva tempo antes de novos claims e inclui tempo da detecção", async () => {
  let tempo = 0, claims = 0;
  const r = await executarEstampasCron(opcoes, deps({
    agora: () => tempo,
    detectar: async continuar => { assert.equal(continuar(), true); tempo = 900; assert.equal(continuar(), false); },
    assumir: async () => { claims++; return job("1"); },
  }));
  assert.equal(claims, 0); assert.equal(r.motivoParada, "limite_tempo");
});
test("encerra após rodada consumir a reserva da próxima", async () => {
  let tempo = 0, claims = 0;
  const r = await executarEstampasCron(opcoes, deps({
    agora: () => tempo,
    assumir: async () => job(String(++claims)),
    processar: async () => { tempo = 900; return "concluido"; },
  }));
  assert.equal(claims, 2); assert.equal(r.concluidos, 2); assert.equal(r.motivoParada, "limite_tempo");
});
test("claim com erro finaliza reservas anteriores antes de falhar", async () => {
  let claims = 0; const processados: string[] = [];
  await assert.rejects(executarEstampasCron(opcoes, deps({
    assumir: async () => { if (++claims === 2) throw new Error("banco"); return job("1"); },
    processar: async j => { processados.push(j.id); return "concluido"; },
  })), /banco/);
  assert.deepEqual(processados, ["1"]);
});
test("erro de processamento aguarda todos os jobs antes de retornar", async () => {
  let claims = 0, terminou = false;
  await assert.rejects(executarEstampasCron(opcoes, deps({
    assumir: async () => job(String(++claims)),
    processar: async j => {
      if (j.id === "1") throw new Error("persistencia");
      await new Promise(resolve => setImmediate(resolve)); terminou = true; return "concluido";
    },
  })), /persistencia/);
  assert.equal(terminou, true);
});
test("rejeita limites inválidos antes de consultar a fila", async () => {
  for (const key of Object.keys(opcoes)) {
    await assert.rejects(executarEstampasCron({ ...opcoes, [key]: 0 }, deps({ detectar: async () => { assert.fail("não deve consultar"); } })), /inteiro positivo/);
  }
});
test("cron nega acesso sem segredo, com token errado e valida provider e timeouts antes de tocar no banco", async () => {
  const chaves = ["CRON_SECRET", "IMAGE_ANALYSIS_PROVIDER", "OPENAI_API_KEY", "OPENAI_IMAGE_ANALYSIS_TIMEOUT_MS", "AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS"];
  const original = Object.fromEntries(chaves.map(k => [k, process.env[k]]));
  const request = (token?: string) => new NextRequest("https://example.com/api/cron/processar-estampas", { headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(request("undefined"))).status, 401);
    process.env.CRON_SECRET = "test-secret";
    assert.equal((await GET(request())).status, 401);
    assert.equal((await GET(request("wrong"))).status, 401);
    process.env.IMAGE_ANALYSIS_PROVIDER = "codex-local";
    assert.equal((await GET(request("test-secret"))).status, 500);
    process.env.IMAGE_ANALYSIS_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    assert.equal((await GET(request("test-secret"))).status, 500);
    process.env.OPENAI_API_KEY = "test-secret-key";
    process.env.OPENAI_IMAGE_ANALYSIS_TIMEOUT_MS = "120000";
    process.env.AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS = "3";
    const resposta = await GET(request("test-secret"));
    assert.equal(resposta.status, 500);
    assert.deepEqual(await resposta.json(), { error: "Falha no processamento de estampas." });
    assert.equal(maxDuration, 300);
  } finally { for (const k of chaves) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; } }
});

 test("detecção tem orçamento próprio para preservar tempo de processamento", async () => {
  let tempo = 0, claims = 0;
  const r = await executarEstampasCron({ ...opcoes, prazoMs: 280_000, reservaJobMs: 155_000 }, deps({
    agora: () => tempo,
    detectar: async continuar => { assert.equal(continuar(), true); tempo = 20_000; assert.equal(continuar(), false); },
    assumir: async () => { claims++; return null; },
  }));
  assert.equal(claims, 1); assert.equal(r.motivoParada, "fila_vazia");
});
