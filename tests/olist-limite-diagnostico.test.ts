import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticarLimiteOlist } from "../src/lib/olist-limite-diagnostico";

test("429 distingue prazo real de estimativa sem copiar dados sensíveis", () => {
  const agora = Date.parse("2026-11-26T14:00:00Z");
  const d = diagnosticarLimiteOlist({ "retry-after": "120", "x-ratelimit-limit": "30", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100", authorization: "segredo", "set-cookie": "privado" }, agora);
  assert.equal(d.origemPrazo, "RETRY_AFTER_OLIST"); assert.equal(d.tentarNovamenteEm, "2026-11-26T14:02:00.000Z");
  assert.equal(d.restante, 0); assert.equal(d.limite, 30); assert.doesNotMatch(JSON.stringify(d), /segredo|privado/);
  assert.equal(diagnosticarLimiteOlist({}, agora).origemPrazo, "ESTIMATIVA_LOCAL");
  assert.equal(diagnosticarLimiteOlist({ "retry-after": "Thu, 26 Nov 2026 14:03:00 GMT" }, agora).tentarNovamenteEm, "2026-11-26T14:03:00.000Z");
  for (const valor of ["", "segredo", -1, Infinity, "1e300", [], null]) {
    assert.equal(diagnosticarLimiteOlist({ "retry-after": valor }, agora).origemPrazo, "ESTIMATIVA_LOCAL");
  }
});
