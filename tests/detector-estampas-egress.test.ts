import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

let consulta: Prisma.Sql;
let linhas: Array<Record<string, unknown>> = [];
Object.assign(globalThis, { prisma: {
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    consulta = Prisma.sql(strings, ...values);
    return linhas;
  },
} });

test("detector restringe candidatos no banco e usa projeção mínima parametrizada", async () => {
  const { listarEstampasParaVerificarAnalise } = await import("../src/repositories/catalogo-estampas-repository");
  const termo = "'); DROP TABLE estampas; --";
  assert.deepEqual(await listarEstampasParaVerificarAnalise({ afterId: "12", limite: 25,
    variantesPermitidas: [" a "], termosIgnoradosNomeArquivo: [termo] }), []);
  assert.match(consulta.sql, /NULLIF\(btrim\(e.content_hash\), ''\) IS NOT NULL/);
  assert.match(consulta.sql, /IS DISTINCT FROM NULLIF\(btrim\(e.ai_processed_hash\), ''\)/);
  assert.match(consulta.sql, /job.status <> 'COMPLETED'/);
  assert.match(consulta.sql, /estampa_filtro.id = e.id/);
  assert.match(consulta.sql, /estampa_variante.id = e.id/);
  assert.doesNotMatch(consulta.sql, /DROP TABLE|ai_metadata|texto_pesquisa|descricao|SELECT \*/);
  assert.ok(consulta.values.includes(BigInt(12)));
  assert.ok(consulta.values.includes(25));
  assert.ok(consulta.values.includes("A"));
  assert.ok(consulta.values.includes(termo.toUpperCase()));
});

test("detector mantém cursor bigint e filtros vazios não restringem variantes ou nomes", async () => {
  const { listarEstampasParaVerificarAnalise } = await import("../src/repositories/catalogo-estampas-repository");
  linhas = [{ id: BigInt("9007199254740993"), content_hash: "hash", ai_processed_hash: null }];
  const resultado = await listarEstampasParaVerificarAnalise();
  assert.equal(resultado[0].id, "9007199254740993");
  assert.doesNotMatch(consulta.sql, /estampa_variante|estampa_filtro|e.id >/);
  await assert.rejects(listarEstampasParaVerificarAnalise({ limite: 0 }));
  await assert.rejects(listarEstampasParaVerificarAnalise({ afterId: "inválido" }));
});
