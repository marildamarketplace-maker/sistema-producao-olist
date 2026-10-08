import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assumirLockPiloto, lerCheckpointsPiloto } from "../src/services/checkpointPilotoEstampas";

test("checkpoint recupera legado, deduplica e ignora apenas cauda interrompida", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "checkpoint-piloto-"));
  const linha = { id: "1", imageHash: "hash", promptHash: "prompt", schemaHash: "schema", promptVersion: "v8", configuracao: { model: "gpt-4o-mini", detail: "low" }, maxOutputTokens: 1600, ok: false, latencyMs: 20, custoEstimadoUsd: null, ordem: 0 };
  try {
    const dir = join(pasta, "piloto-estampas-123");
    await mkdir(dir);
    const arquivo = join(dir, "resultados.jsonl");
    await writeFile(arquivo, JSON.stringify(linha) + "\n" + JSON.stringify(linha) + "\n" + "{interrompido");
    assert.equal((await lerCheckpointsPiloto(pasta)).length, 1);
    await writeFile(arquivo, "{inválido}\n" + JSON.stringify(linha) + "\n");
    await assert.rejects(lerCheckpointsPiloto(pasta), /Checkpoint inválido/u);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test("lock impede concorrência e libera para a próxima execução", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "lock-piloto-"));
  try {
    const liberar = await assumirLockPiloto(pasta);
    await assert.rejects(assumirLockPiloto(pasta), /Já existe um piloto/u);
    await liberar();
    await (await assumirLockPiloto(pasta))();
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test("leitura conjunta encontra históricos OpenAI, Gemini e relatórios unificados", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "checkpoint-conjunto-"));
  const linha = { id: "1", imageHash: "hash", promptHash: "prompt", schemaHash: "schema", promptVersion: "v8", configuracao: { model: "gpt-4o-mini", detail: "low" }, maxOutputTokens: 1600, ok: true, latencyMs: 20, custoEstimadoUsd: 0.001, ordem: 0 };
  const gemini = { ...linha, configuracao: { model: "gemini-3.8-flash", detail: "high", provider: "gemini", thinkingLevel: "low" }, maxOutputTokens: 4096 };
  try {
    const antigo = join(pasta, "piloto-estampas-123");
    const antigoGemini = join(pasta, "gemini", "piloto-estampas-124");
    const conjunto = join(pasta, "piloto-estampas-125");
    for (const diretorio of [antigo, antigoGemini, conjunto]) await mkdir(diretorio, { recursive: true });
    await writeFile(join(antigo, "resultados.jsonl"), JSON.stringify(linha) + "\n");
    await writeFile(join(antigoGemini, "resultados.jsonl"), JSON.stringify(gemini) + "\n");
    await writeFile(join(conjunto, "resultados.jsonl"), JSON.stringify(linha) + "\n" + JSON.stringify(gemini) + "\n");
    assert.equal((await lerCheckpointsPiloto(pasta, true)).length, 2);
    assert.deepEqual(await lerCheckpointsPiloto(join(pasta, "inexistente"), true), []);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
