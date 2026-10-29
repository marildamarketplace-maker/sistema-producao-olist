import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { casosCategorias, capturarPesquisaCategoria, consultaCorrespondencias, fixtureCategorias, predicadoCategoriaAnterior } from "./helpers/categorias-postgres";

test("PostgreSQL: categoria conserva correspondências, percentuais e contagens em ambos os modos", {
  skip: !process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='15s'");
    for (const caso of casosCategorias) {
      const { contagem } = await capturarPesquisaCategoria(caso.filtros);
      for (const texto of [contagem.text, predicadoCategoriaAnterior(contagem.text)]) {
        const total = await client.query(`${fixtureCategorias} ${texto}`, contagem.values);
        assert.deepEqual(total.rows, [{ total: String(caso.ids.length), completas: String(caso.completas), parciais: String(caso.parciais) }], caso.nome);
        const registros = await client.query(`${fixtureCategorias} ${consultaCorrespondencias(texto, Boolean(caso.filtros.preferencias?.length))}`, contagem.values);
        assert.deepEqual(registros.rows.map(row => row.id), caso.ids, caso.nome);
        assert.deepEqual(registros.rows.map(row => row.percentual), caso.percentuais ?? caso.ids.map(() => null), caso.nome);
      }
    }
  } finally {
    await client.end(); // Fecha a conexão e desfaz a transação somente de leitura.
  }
});
