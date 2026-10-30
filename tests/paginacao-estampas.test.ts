import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import pg from "pg";
import type { FiltrosPesquisaEstampas } from "../src/repositories/pesquisa-estampas-repository";

const consultas: Prisma.Sql[] = [];
Object.assign(globalThis, { prisma: {
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(0) }] : []);
  },
} });

const ordens = ["RELEVANCIA", "RECENTES", "CODIGO_ASC", "CODIGO_DESC"] as const;
const registros = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  codigo: ["MV100", "mv100", "MV101", "MV102", "MV099", "MV103", "MV104", "MV105", "MV100", "MV106"][i],
  variante: ["A", "a", "B", null, "Z", null, "A", "A", "B", "C"][i],
  titulo: i === 7 ? "flor rosa rascunho" : "flor rosa",
  categorias: [2, 6].includes(i) ? ["geométrico"] : ["botânico"],
  cores: [3, 6].includes(i) ? ["azul"] : ["rosa"],
  is_active: i !== 4,
  processing_status: i === 5 ? "PENDING" : "COMPLETED",
  created_at: i < 2 ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
  updated_at: i === 1 ? null : "2026-01-02T00:00:00Z",
  search_vector: i === 7 ? "'flor':1 'rosa':2 'rascunho':3" : "'flor':1 'rosa':2",
  ai_metadata: { response: { linguagemVisual: { estado: "IDENTIFICADO", valores: ["aquarelado"] } } },
}));

function esperados(preferencias: boolean, ordem: typeof ordens[number]) {
  const categoria = (r: typeof registros[number]) => r.categorias.includes("botânico");
  const cor = (r: typeof registros[number]) => r.cores.includes("rosa");
  const percentual = (r: typeof registros[number]) => (Number(categoria(r)) + Number(cor(r))) * 50;
  const compararTexto = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const elegiveis = registros.filter(r => r.is_active && r.processing_status === "COMPLETED"
    && (preferencias ? categoria(r) || cor(r) : categoria(r) && cor(r)));
  return elegiveis.sort((a, b) => {
    if (ordem === "CODIGO_ASC" || ordem === "CODIGO_DESC") {
      const direcao = ordem === "CODIGO_ASC" ? 1 : -1;
      return direcao * (compararTexto(a.codigo.toLowerCase(), b.codigo.toLowerCase())
        || compararTexto((a.variante ?? "").toLowerCase(), (b.variante ?? "").toLowerCase()) || a.id - b.id);
    }
    if (ordem === "RELEVANCIA" && preferencias) {
      // DESC no PostgreSQL ordena NULL primeiro, preservando o contrato atual.
      return percentual(b) - percentual(a) || (a.updated_at === null ? -1 : b.updated_at === null ? 1 : 0) || b.id - a.id;
    }
    return compararTexto(b.created_at, a.created_at) || b.id - a.id;
  }).map(r => ({ id: String(r.id), percentual: preferencias ? percentual(r) : null }));
}

test("SQL limita IDs e pontuações antes de projetar os detalhes, preservando ranking textual", async () => {
  const { pesquisarCatalogoEstampas } = await import("../src/repositories/pesquisa-estampas-repository");
  consultas.length = 0;
  await pesquisarCatalogoEstampas({ consulta: "flor rosa -rascunho", ordenacao: "RELEVANCIA", limite: 24, offset: 24, status: "COMPLETED" });
  const [lista, contagem] = consultas;
  const [selecao, detalhes] = lista.sql.split(")\n      SELECT");
  assert.match(selecao, /WITH pagina AS MATERIALIZED/);
  assert.match(selecao, /ts_rank_cd/);
  assert.match(selecao, /NOT \(/);
  assert.match(selecao, /ORDER BY aderencia.percentual DESC, relevancia DESC/);
  assert.match(selecao, /LIMIT \?\s+OFFSET \?/);
  assert.doesNotMatch(selecao, /ai_metadata|AS "atributosDesign"/);
  assert.match(detalhes, /e.ai_metadata->'response'/);
  assert.match(detalhes, /pagina.relevancia AS relevancia/);
  assert.match(detalhes, /pagina.percentual AS "percentualCorrespondencia"/);
  assert.match(detalhes, /INNER JOIN pagina ON pagina.id = e.id/);
  assert.match(detalhes, /ORDER BY pagina.percentual DESC, relevancia DESC/);
  assert.doesNotMatch(contagem.sql, /WITH pagina|LIMIT|OFFSET/);
});

test("PostgreSQL: páginas, empates, percentuais e ordenações preservam a seleção esperada", {
  skip: !process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL,
}, async () => {
  const { pesquisarCatalogoEstampas } = await import("../src/repositories/pesquisa-estampas-repository");
  const client = new pg.Client({ connectionString: process.env.PESQUISA_ESTAMPAS_TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    for (const preferencial of [false, true]) for (const ordenacao of ordens) for (const offset of [0, 2, 20]) {
      consultas.length = 0;
      await pesquisarCatalogoEstampas({ categoria: "botânico", cores: ["rosa"],
        preferencias: preferencial ? ["categoria", "cores"] : [], correspondenciaMinima: 50,
        ordenacao, limite: 2, offset, status: "COMPLETED" } satisfies FiltrosPesquisaEstampas);
      const [lista, contagem] = consultas;
      const executar = async (sql: Prisma.Sql) => {
        const deslocado = sql.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`);
        const corpo = deslocado.trimStart().startsWith("WITH ") ? deslocado.trimStart().slice(5) : deslocado;
        const prefixo = `WITH estampas AS (SELECT (jsonb_populate_record(NULL::public.estampas, item)).* FROM jsonb_array_elements($1::jsonb) item)`;
        return client.query(`${prefixo}${deslocado.trimStart().startsWith("WITH ") ? ", " : " "}${corpo}`, [JSON.stringify(registros), ...sql.values]);
      };
      const resultado = await executar(lista);
      const esperado = esperados(preferencial, ordenacao);
      assert.deepEqual(resultado.rows.map(r => ({ id: r.id, percentual: r.percentualCorrespondencia })), esperado.slice(offset, offset + 2), `${preferencial}/${ordenacao}/${offset}`);
      for (const row of resultado.rows) {
        assert.equal(row.relevancia, 0);
        assert.equal(row.termosEncontrados.length + row.termosAusentes.length, preferencial ? 2 : 0);
      }
      const totais = await executar(contagem);
      assert.equal(Number(totais.rows[0].total), esperado.length);
      assert.equal(Number(totais.rows[0].completas), preferencial ? esperado.filter(r => r.percentual === 100).length : 0);
      assert.equal(Number(totais.rows[0].parciais), preferencial ? esperado.filter(r => r.percentual === 50).length : 0);
    }
  } finally {
    if (client) await client.end();
  }
});
