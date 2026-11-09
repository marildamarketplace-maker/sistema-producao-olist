import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import pg from "pg";
import { correspondenciaEstampasSql } from "../src/repositories/correspondencia-estampas-sql";

test("nome e caminhos participam dos candidatos, cobertura, obrigatórios e exclusões", () => {
  const flexivel = correspondenciaEstampasSql("representante -rascunho");
  const obrigatorio = correspondenciaEstampasSql("representante", [], false);
  for (const sql of [flexivel.candidatos, flexivel.percentual, flexivel.encontrados,
    flexivel.ausentes, flexivel.exclusoes[0], obrigatorio.obrigatorios[0]]) {
    assert.match(sql.sql, /e\.search_vector @@/);
    assert.match(sql.sql, /e\.search_vector_arquivo @@/);
    assert.doesNotMatch(sql.sql, /COALESCE|to_tsvector/);
  }
  assert.match(flexivel.exclusoes[0].sql, /IS NOT TRUE$/);
  assert.deepEqual(flexivel.criterios, ["representante"]);
  assert.doesNotMatch(correspondenciaEstampasSql("MV27849-B").obrigatorios[0].sql, /search_vector/);
});

test("PostgreSQL: encontra termos em arquivos e pastas com acentos e separadores", {
  skip: !process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query(`
      BEGIN;
      CREATE TEMP TABLE estampas (
        id integer PRIMARY KEY,
        original_filename text,
        original_relative_path text,
        storage_key text,
        search_vector tsvector
      );
      INSERT INTO pg_temp.estampas VALUES (1, 'Coleção_Antiga.jpg', NULL, NULL, NULL);
    `);
    const migracao = readFileSync(new URL(
      "../prisma/migrations/20261109130000_vetor_arquivo_estampas/migration.sql",
      import.meta.url,
    ), "utf8");
    await client.query(migracao.replace(/^BEGIN;|COMMIT;\s*$/g, "").replaceAll("public.", "pg_temp."));
    const legado = await client.query("SELECT search_vector_arquivo::text AS vetor FROM pg_temp.estampas WHERE id = 1");
    assert.match(legado.rows[0].vetor, /'colecao':1/);

    const casos = [
      ["representante", "Representantes_final.jpg", null, null, "", 100],
      ["representante", "123.jpg", "Coleção/REPRESENTANTE/123.jpg", null, "", 100],
      ["representante", null, null, "colecao\\representante\\123.jpg", "", 100],
      ["colecao", null, "Coleção/123.jpg", null, "", 100],
      ["representante azul", "representante.jpg", null, null, "azul", 100],
      ["representante azul", "representante.jpg", null, null, "", 50],
      ["representante", null, null, null, "representante", 100],
      ["representante", null, null, null, "floral", 0],
      ["representante", null, null, null, null, 0],
      ['"flor rosa"', "flor-rosa.jpg", null, null, null, 100],
      ['"flor rosa"', "flor.jpg", null, null, "rosa", 0],
    ] as const;
    for (const [consulta, nome, caminho, chave, metadados, esperado] of casos) {
      const sql = correspondenciaEstampasSql(consulta);
      await client.query(`
        UPDATE pg_temp.estampas SET original_filename = $1, original_relative_path = $2,
          storage_key = $3, search_vector = to_tsvector('simple', $4) WHERE id = 1`,
      [nome, caminho, chave, metadados]);
      const resultado = await client.query(`
        SELECT ${sql.percentual.text} AS percentual
        FROM pg_temp.estampas e WHERE id = 1`, sql.percentual.values);
      assert.equal(resultado.rows[0].percentual, esperado, `${consulta}: ${nome ?? caminho ?? chave}`);
      const candidato = await client.query(`
        SELECT id FROM pg_temp.estampas e WHERE ${sql.candidatos.text}`, sql.candidatos.values);
      assert.equal(candidato.rowCount, Number(esperado > 0));
      const [exclusao] = correspondenciaEstampasSql(`-${consulta.startsWith('"') ? consulta : consulta.split(" ")[0]}`).exclusoes;
      const excluido = await client.query(`
        SELECT id FROM pg_temp.estampas e WHERE ${exclusao.text}`, exclusao.values);
      assert.equal(excluido.rowCount, Number(esperado === 0));
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});
