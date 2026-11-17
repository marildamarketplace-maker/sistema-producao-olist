import assert from "node:assert/strict";
import test from "node:test";
import { cotaDaRespostaSync, esperaAuditoriaSync, interpretarCotaSync } from "../src/lib/olist-sync/ritmo";

test("ritmo da auditoria é de até 30 leituras/minuto com ou sem headers", () => {
  assert.equal(esperaAuditoriaSync(null), 2_000);
  assert.equal(esperaAuditoriaSync({ limite: 60, restante: 59, resetSegundos: 60 }), 2_000);
  assert.equal(esperaAuditoriaSync({ limite: 140, restante: 139, resetSegundos: 60 }), 2_000);
});
test("cota menor e orçamento consumido por outras integrações reduzem o ritmo", () => {
  assert.equal(esperaAuditoriaSync({ limite: 30, restante: 29, resetSegundos: 60 }), 4_000);
  assert.equal(esperaAuditoriaSync({ limite: 60, restante: 10, resetSegundos: 30 }), 7_500);
  assert.equal(esperaAuditoriaSync({ limite: 60, restante: 6, resetSegundos: 30 }), 30_250);
  assert.equal(esperaAuditoriaSync({ limite: 60, restante: 0, resetSegundos: 60 }), 60_250);
});
test("429 aguarda reset e Retry-After sem elevar a taxa automaticamente", () => {
  assert.equal(esperaAuditoriaSync(null, true), 60_000);
  assert.equal(esperaAuditoriaSync(null, true, 90_000), 90_000);
  assert.equal(esperaAuditoriaSync({ limite: 60, restante: 0, resetSegundos: 90 }, true, 30_000), 90_250);
});
test("headers têm limites numéricos e dados inválidos não contaminam o checkpoint", () => {
  assert.deepEqual(interpretarCotaSync("60", "42", "20"), { limite: 60, restante: 42, resetSegundos: 20 });
  assert.deepEqual(interpretarCotaSync(60, 0, 0.5), { limite: 60, restante: 0, resetSegundos: 0.5 });
  for (const valores of [[undefined, undefined, undefined], [0, 0, 60], [60, -1, 60], [60, 61, 60], [60, 20, -1], [60, 20, 86401], [Infinity, 0, 1], ["Bearer segredo", 1, 60], ["", 0, 1], [60, 1.5, 60], [100001, 1, 60]])
    assert.equal(interpretarCotaSync(...valores as [unknown, unknown, unknown]), null);
  for (const resposta of [null, undefined, [], {}, { cotaLeitura: "segredo" }, { cotaLeitura: { limite: 60, restante: 0, resetSegundos: -1 } }]) assert.equal(cotaDaRespostaSync(resposta), null);
});
