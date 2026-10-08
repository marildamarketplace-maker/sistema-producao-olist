import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DIRETORIO_PILOTO_UNIFICADO, consolidarRegistrosPiloto, gravarPilotoUnificado, resumirPiloto, unificarArquivosPiloto } from "../src/services/arquivoPilotoEstampas";
import type { RegistroPiloto } from "../src/services/pilotoModelosEstampaService";

const base: RegistroPiloto = { id: "1", imageHash: "img", promptHash: "prompt", schemaHash: "schema", promptVersion: "v8", configuracao: { model: "gpt-4o-mini", detail: "low" }, maxOutputTokens: 1600, ok: false, latencyMs: 20, custoEstimadoUsd: 0.001, ordem: 0, erro: "INVALID_JSON" };

test("consolidação mantém um sucesso por combinação, preserva falhas e não duplica custo de cópias", () => {
  const sucesso = { ...base, ok: true, tentativaId: "sucesso", custoEstimadoUsd: 0.002 };
  const falha = { ...base, tentativaId: "falha", schemaHash: "novo", custoEstimadoUsd: 0.003 };
  const registros = consolidarRegistrosPiloto([base, base, sucesso, sucesso, falha]);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].tentativaId, "sucesso");
  assert.equal(registros[0].historicoTentativas?.length, 3);
  assert.equal(resumirPiloto(registros)[0].custoConhecidoUsd, 0.006);
  assert.deepEqual(consolidarRegistrosPiloto([...registros, ...registros]), registros);
  assert.equal(consolidarRegistrosPiloto([base, { ...base, configuracao: { ...base.configuracao, detail: "high" } }]).length, 2);
  assert.equal(consolidarRegistrosPiloto([base, { ...base, imageHash: "nova-imagem" }]).length, 2);
});

test("retomada usa caminho fixo, mantém bytes anteriores e importa legados sem removê-los", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "arquivo-piloto-"));
  try {
    const destino = join(raiz, DIRETORIO_PILOTO_UNIFICADO);
    const antigo = join(raiz, "piloto-estampas-123");
    const gemini = join(raiz, "gemini", "piloto-estampas-456");
    for (const dir of [destino, antigo, gemini]) await mkdir(dir, { recursive: true });
    const original = JSON.stringify(base) + "\n";
    const sucesso = { ...base, ok: true };
    await writeFile(join(destino, "resultados.jsonl"), original);
    await writeFile(join(antigo, "resultados.jsonl"), JSON.stringify(sucesso) + "\n");
    await writeFile(join(gemini, "resultados.jsonl"), JSON.stringify({ ...base, configuracao: { model: "gemini-3.8-flash", detail: "high", provider: "gemini" } }) + "\n");
    const unificado = await unificarArquivosPiloto(raiz);
    assert.equal(unificado.pasta, destino);
    assert.equal(unificado.registros.length, 2);
    assert.equal(unificado.registros[0].ok, true);
    assert.equal(await readFile(join(antigo, "resultados.jsonl"), "utf8"), JSON.stringify(sucesso) + "\n");
    const antes = await readFile(join(destino, "resultados.jsonl"), "utf8");
    assert.ok(antes.startsWith(original));
    await unificarArquivosPiloto(raiz);
    assert.equal(await readFile(join(destino, "resultados.jsonl"), "utf8"), antes);
    const nova = { ...base, tentativaId: "nova", configuracao: { model: "gemini-3.8-flash", detail: "high" as const, provider: "gemini" as const }, ok: true };
    const atuais = await gravarPilotoUnificado(destino, [nova]);
    assert.equal(atuais.length, 2);
    assert.ok(atuais.every(r => r.ok));
    const depois = await readFile(join(destino, "resultados.jsonl"), "utf8");
    assert.ok(depois.startsWith(antes));
    assert.equal(depois.trim().split("\n").length, 4);
    await gravarPilotoUnificado(destino, [nova]);
    assert.equal(await readFile(join(destino, "resultados.jsonl"), "utf8"), depois);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("arquivo com cauda corrompida é preservado e impede novas chamadas/gravações", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "arquivo-corrompido-"));
  try {
    const pasta = join(raiz, DIRETORIO_PILOTO_UNIFICADO);
    await mkdir(pasta, { recursive: true });
    const path = join(pasta, "resultados.jsonl");
    const original = JSON.stringify(base) + "\n{interrompido";
    await writeFile(path, original);
    await assert.rejects(gravarPilotoUnificado(pasta, [{ ...base, ok: true }]), /Checkpoint inválido/);
    assert.equal(await readFile(path, "utf8"), original);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});
