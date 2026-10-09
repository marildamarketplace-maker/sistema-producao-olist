import assert from "node:assert/strict";
import test from "node:test";
import type { EstampaJobPainelRow } from "../src/repositories/estampa-jobs-repository";

// O mapeamento não consulta o banco; evita inicializar um cliente real.
Object.assign(globalThis, { prisma: {} });
const base: EstampaJobPainelRow = {
  id: "job-antigo", estampaId: BigInt(123), status: "COMPLETED",
  tentativas: 1, maxTentativas: 3, ultimoErro: null,
  modeloUtilizado: "modelo-da-execucao", createdAt: new Date("2026-10-09T12:00:00Z"),
  startedAt: null, finishedAt: null, manualRequested: false,
  codigo: "123", variante: "A", previewUrl: null, processedAt: null,
  aiMetadata: { model: "modelo-mais-recente", response: { titulo: "Atual" } },
};

test("modelo do job permanece independente dos metadados atuais do catálogo", async () => {
  const { paraJobPainel } = await import("../src/services/consultarEstampaJobsPainelService");
  const job = paraJobPainel(base);
  assert.equal(job.modeloUtilizado, "modelo-da-execucao");
  assert.equal(job.analise?.modelo, "modelo-mais-recente");
  assert.deepEqual(job.analise?.resultado, { titulo: "Atual" });
});

test("job legado sem modelo registrado não recebe o modelo de outra execução", async () => {
  const { paraJobPainel } = await import("../src/services/consultarEstampaJobsPainelService");
  assert.equal(paraJobPainel({ ...base, modeloUtilizado: null }).modeloUtilizado, null);
});

test("job sem análise mantém seu modelo registrado e o erro de falha", async () => {
  const { paraJobPainel } = await import("../src/services/consultarEstampaJobsPainelService");
  const job = paraJobPainel({ ...base, status: "FAILED", aiMetadata: null, ultimoErro: "Falha de processamento" });
  assert.equal(job.modeloUtilizado, "modelo-da-execucao");
  assert.equal(job.analise, null);
  assert.equal(job.ultimoErro, "Falha de processamento");
});
