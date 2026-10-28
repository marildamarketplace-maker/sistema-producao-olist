import assert from "node:assert/strict";
import test from "node:test";
import { varianteEstampaPermitida } from "../src/domain/filtro-variante-estampa";
import { filtroVarianteEstampaSql } from "../src/repositories/filtro-variante-estampa-sql";
import { configuracaoJobEstampasSchema } from "../src/domain/configuracao-job-estampas";

test("filtro exato permite alternar A, B, múltiplas e todas, incluindo nulas", () => {
  assert.equal(varianteEstampaPermitida(" a ", ["A"]), true);
  for (const v of ["B", "AB", "A1", null, ""]) assert.equal(varianteEstampaPermitida(v, ["A"]), false);
  assert.equal(varianteEstampaPermitida("A", ["B"]), false);
  assert.equal(varianteEstampaPermitida("B", ["B"]), true);
  assert.equal(varianteEstampaPermitida("D70", ["A", "d70"]), true);
  for (const v of ["A", "B", null, ""]) assert.equal(varianteEstampaPermitida(v, []), true);
});
test("SQL de claim usa variante cadastrada e parâmetros literais", () => {
  const filtro = filtroVarianteEstampaSql(["a", "B", "a", "' OR TRUE --"]);
  assert.deepEqual(filtro.values, ["A", "B", "' OR TRUE --"]);
  assert.match(filtro.sql, /estampa_variante.id = estampa_jobs.estampa_id/);
  assert.doesNotMatch(filtro.sql, /OR TRUE/);
  assert.equal(filtroVarianteEstampaSql([]).sql, "");
});
test("configuração normaliza variantes e rejeita valores inválidos", () => {
  const base = { pausado: true, termosIgnoradosNomeArquivo: [] };
  assert.deepEqual(configuracaoJobEstampasSchema.parse({ ...base, variantesPermitidas: [" a ", "A", "b"] }).variantesPermitidas, ["A", "B"]);
  for (const variantesPermitidas of [[""], ["a".repeat(101)], Array(101).fill("A"), "A"]) {
    assert.equal(configuracaoJobEstampasSchema.safeParse({ ...base, variantesPermitidas }).success, false);
  }
});
