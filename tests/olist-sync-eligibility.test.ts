import test from "node:test";
import assert from "node:assert/strict";
import { aplicativoElegivelSync } from "../src/lib/olist-sync/elegibilidade";

const grupo = { aplicativoPaiId: "pai", aplicativosBloqueados: ["bloqueado"] };

test("elegibilidade permite filhos diretos sem confundir seleção e política", () => {
  // Um filho novo/desabilitado continua disponível para seleção explícita.
  assert.equal(aplicativoElegivelSync(grupo, { id: "novo", aplicativoPaiId: "pai" }), true);
});

test("elegibilidade recusa pai, externos, órfãos e netos", () => {
  for (const aplicativo of [
    { id: "pai", aplicativoPaiId: "pai" },
    { id: "externo", aplicativoPaiId: "outro-pai" },
    { id: "orfao", aplicativoPaiId: null },
    { id: "neto", aplicativoPaiId: "filho" },
  ]) assert.equal(aplicativoElegivelSync(grupo, aplicativo), false);
});

test("bloqueio independe dos IDs do piloto e pertence à política do grupo", () => {
  const aplicativo = { id: "bloqueado", aplicativoPaiId: "pai" };
  assert.equal(aplicativoElegivelSync(grupo, aplicativo), false);
  assert.equal(aplicativoElegivelSync({ ...grupo, aplicativosBloqueados: [] }, aplicativo), true);
  assert.equal(aplicativoElegivelSync(
    { aplicativoPaiId: "outro-pai", aplicativosBloqueados: [] },
    { ...aplicativo, aplicativoPaiId: "outro-pai" },
  ), true);
});
