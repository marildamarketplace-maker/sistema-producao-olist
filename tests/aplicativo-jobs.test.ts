import assert from "node:assert/strict";
import test from "node:test";
import {
  aplicativoTemJob,
  CHAVES_JOB,
  listarChavesJobs,
} from "../src/lib/aplicativo-jobs";

test("identifica chaves de job separadas por vírgula", () => {
  const jobs = "BAIXA_ESTOQUE, NOTIFICAR,RENOVAR_TOKENS,VALIDADOR_ESTOQUE,CONFIRMACAO_ENTREGA_PRODUCAO";

  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.BAIXA_ESTOQUE), true);
  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.NOTIFICAR), true);
  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.RENOVAR_TOKENS), true);
  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.VALIDADOR_ESTOQUE), true);
  assert.equal(
    aplicativoTemJob(jobs, CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO),
    true,
  );
});

test("normaliza espaços e caixa sem aceitar correspondência parcial", () => {
  const jobs = "  notificar , renovar_tokens_extra ";

  assert.deepEqual([...listarChavesJobs(jobs)], [
    "NOTIFICAR",
    "RENOVAR_TOKENS_EXTRA",
  ]);
  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.NOTIFICAR), true);
  assert.equal(aplicativoTemJob(jobs, CHAVES_JOB.RENOVAR_TOKENS), false);
});

test("não habilita jobs quando a configuração está vazia", () => {
  assert.equal(aplicativoTemJob("", CHAVES_JOB.BAIXA_ESTOQUE), false);
  assert.equal(aplicativoTemJob(null, CHAVES_JOB.NOTIFICAR), false);
  assert.equal(aplicativoTemJob(null, CHAVES_JOB.VALIDADOR_ESTOQUE), false);
  assert.equal(
    aplicativoTemJob(null, CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO),
    false,
  );
});
