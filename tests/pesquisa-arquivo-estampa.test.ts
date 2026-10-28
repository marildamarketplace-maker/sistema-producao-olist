import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { correspondenciaEstampasSql } from "../src/repositories/correspondencia-estampas-sql";

test("nome e caminhos participam dos candidatos, cobertura, obrigatórios e exclusões", () => {
  const flexivel = correspondenciaEstampasSql("representante -rascunho");
  const obrigatorio = correspondenciaEstampasSql("representante", [], false);
  for (const sql of [flexivel.candidatos, flexivel.percentual, flexivel.encontrados,
    flexivel.ausentes, flexivel.exclusoes[0], obrigatorio.obrigatorios[0]]) {
    for (const campo of ["original_filename", "original_relative_path", "storage_key"]) {
      assert.ok(sql.sql.includes(`e.${campo}`));
    }
    assert.match(sql.sql, /COALESCE\(e.search_vector @@/);
  }
  assert.match(flexivel.exclusoes[0].sql, /^NOT/);
  assert.deepEqual(flexivel.criterios, ["representante"]);
  assert.doesNotMatch(correspondenciaEstampasSql("MV27849-B").obrigatorios[0].sql, /original_filename/);
});

test("PostgreSQL: encontra termos em arquivos e pastas com acentos e separadores", {
  skip: !process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL });
  try {
    await client.connect();
    const casos = [
      ["representante", "Representantes_final.jpg", null, null, "", 100],
      ["representante", "123.jpg", "Coleção/REPRESENTANTE/123.jpg", null, "", 100],
      ["representante", null, null, "colecao\\representante\\123.jpg", "", 100],
      ["colecao", null, "Coleção/123.jpg", null, "", 100],
      ["representante azul", "representante.jpg", null, null, "azul", 100],
      ["representante azul", "representante.jpg", null, null, "", 50],
      ["representante", null, null, null, "representante", 100],
      ["representante", null, null, null, "floral", 0],
    ] as const;
    for (const [consulta, nome, caminho, chave, metadados, esperado] of casos) {
      const sql = correspondenciaEstampasSql(consulta);
      const deslocar = (texto: string, offset: number) => texto.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
      const resultado = await client.query(`
        SELECT ${deslocar(sql.percentual.text, 4)} AS percentual,
          ${deslocar(sql.candidatos.text, 4 + sql.percentual.values.length)} AS candidato
        FROM (SELECT $1::text AS original_filename, $2::text AS original_relative_path,
          $3::text AS storage_key, to_tsvector('simple', $4::text) AS search_vector) e`,
      [nome, caminho, chave, metadados, ...sql.percentual.values, ...sql.candidatos.values]);
      assert.equal(resultado.rows[0].percentual, esperado, `${consulta}: ${nome ?? caminho ?? chave}`);
      assert.equal(resultado.rows[0].candidato, esperado > 0);
    }
  } finally {
    await client.end();
  }
});
