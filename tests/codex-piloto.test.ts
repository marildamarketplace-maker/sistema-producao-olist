import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIGURACOES_PILOTO_CODEX, executarPilotoModelosEstampa, type RegistroPiloto } from "../src/services/pilotoModelosEstampaService";
import { gravarPilotoUnificado, chaveCombinacaoPiloto, consolidarRegistrosPiloto, resumirPiloto } from "../src/services/arquivoPilotoEstampas";
import { lerArquivoCheckpointsPiloto } from "../src/services/checkpointPilotoEstampas";

test("Codex piloto persiste configuração, retoma checkpoint e mantém custo desconhecido", async t => {
  const pasta = await mkdtemp(join(tmpdir(), "piloto-codex-test-"));
  t.after(() => rm(pasta, { recursive: true, force: true }));
  const registros: RegistroPiloto[] = [];
  await executarPilotoModelosEstampa([{ id: "1", preview_url: "x" }], async r => { registros.push(r); }, {
    configuracoes: CONFIGURACOES_PILOTO_CODEX,
    carregar: async () => ({ buffer: Buffer.from([1]), mimeType: "image/png", sizeBytes: 1, sourceUrl: "x", filename: null }),
    criarProvider: (_model, _detail, config) => {
      assert.ok(CONFIGURACOES_PILOTO_CODEX.includes(config));
      return { name: "codex-local", model: config.model, async analyzeImage() { throw new Error("falha simulada"); } };
    },
  });
  assert.equal(registros[0].custoEstimadoUsd, null);
  assert.equal(registros.length, 3);
  assert.deepEqual(registros.map(r => [r.configuracao.model, r.configuracao.reasoningEffort]), [["gpt-6.1-sol", "high"], ["gpt-6-astra", "high"], ["gpt-6-luna", "medium"]]);
  const comUso = registros.map((r, i) => ({ ...r, diagnostico: { usage: { inputTokens: 100 * (i + 1), outputTokens: 20, totalTokens: 100 * (i + 1) + 20, cachedInputTokens: 10 } } }));
  const resumo = resumirPiloto(consolidarRegistrosPiloto([...comUso, ...comUso]));
  assert.deepEqual(resumo.map(r => r.tokens.total.totalConhecido), [120, 220, 320]);
  assert.ok(resumo.every(r => r.chamadas === 1 && r.tokens.total.chamadasSemInformacao === 0));
  assert.equal(resumirPiloto(consolidarRegistrosPiloto(registros))[0].tokens.total.totalConhecido, null);
  await gravarPilotoUnificado(pasta, registros);
  const lidos = await lerArquivoCheckpointsPiloto(join(pasta, "resultados.jsonl"));
  assert.deepEqual(lidos[0].configuracao, CONFIGURACOES_PILOTO_CODEX[0]);
  assert.notEqual(chaveCombinacaoPiloto(lidos[0]), chaveCombinacaoPiloto({ ...lidos[0], configuracao: { ...lidos[0].configuracao, reasoningEffort: undefined } }));
});
