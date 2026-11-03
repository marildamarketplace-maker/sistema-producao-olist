import assert from "node:assert/strict";
import test from "node:test";
import { tipoCorteDoSku } from "../src/lib/producao-tipo-corte";
import { importarItensProducao } from "../src/lib/importar-itens-producao";

const sku = "TP/LENCO-MODA-AFRO-C/LASER-TA/70X70-EST/6907-E";
test("reconhece marcador C/LASER sem alterar SKU nem confundir outros cortes", () => {
  assert.equal(tipoCorteDoSku(sku), "LASER");
  assert.equal(tipoCorteDoSku(sku.toLowerCase()), "LASER");
  for (const outro of ["SKU-A", sku.replace("C/LASER", "S/LASER"), sku.replace("C/LASER", "C/LASERADO")]) {
    assert.equal(tipoCorteDoSku(outro), null);
  }
});
test("importação infere laser somente em novos itens e respeita corte explícito", () => {
  const produtos = [{ id: "produto", sku }];
  const novo = importarItensProducao(`${sku};2`, produtos, []).linhas[0];
  assert.equal(novo.tipoCorte, "LASER");
  assert.equal(novo.sku, sku);
  assert.equal(importarItensProducao(`${sku};3`, produtos, [{ ...novo, tipoCorte: "PADRAO" }]).linhas[0].tipoCorte, "PADRAO");
  assert.equal(importarItensProducao(`${sku};2;não`, produtos, []).linhas[0].tipoCorte, null);
});
