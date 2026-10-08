import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { consultaEstampasSql } from "../src/repositories/consulta-estampas-sql";

test("consulta vazia não gera uma tsquery inválida", () => {
  assert.equal(consultaEstampasSql("").sql, "NULL::tsquery");
});

test("consulta e transformação de prefixos são parametrizadas", () => {
  const entrada = "cereja'); DROP TABLE estampas; --";
  const consulta = consultaEstampasSql(entrada);
  assert.equal(consulta.values[0], entrada);
  assert.doesNotMatch(consulta.sql, /DROP TABLE/);
  assert.match(consulta.sql, /websearch_to_tsquery/);
  assert.match(consulta.sql, /extensions.unaccent/);
  assert.equal(consulta.values[2], String.raw`\1:*`);
  const regex = new RegExp(consulta.values[1] as string, "g");
  const transformar = (texto: string) => texto.replace(regex, "$1:*");
  assert.equal(transformar("'cereja' & 'vermelha'"), "'cereja':* & 'vermelha':*");
  assert.equal(transformar("'poa' | 'polka' <-> 'dot'"), "'poa':* | 'polka':* <-> 'dot':*");
  assert.equal(transformar("'d''agua'"), "'d''agua':*");
});

test("PostgreSQL: singular encontra plural e preserva conjunção, acentos e frases", {
  skip: !process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL });
  try {
    await client.connect();
    for (const [consulta, documento, esperado] of [
      ["cereja", "cerejas", true],
      ["cereja", "cereja", true],
      ["cerejas", "cereja", false],
      ["cereja vermelha", "cerejas vermelhas", true],
      ["cereja vermelha", "cerejas azuis", false],
      ["poá", "poas", true],
      ['"polka dot" OR cereja', "polka dots", true],
      ['"polka dot"', "polka grande dot", false],
      ["cereja", "banana", false],
    ] as const) {
      const sql = consultaEstampasSql(consulta);
      const deslocada = sql.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`);
      const resultado = await client.query(
        `SELECT to_tsvector('simple', extensions.unaccent($1)) @@ (${deslocada}) AS encontrou`,
        [documento, ...sql.values],
      );
      assert.equal(resultado.rows[0].encontrou, esperado, `${consulta}: ${documento}`);
    }
  } finally {
    await client.end();
  }
});
