import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { criarPostgresMemoria, type BancoMemoria } from "./helpers/postgres-memoria";

type Entrada = { migration: string; acao: string; sha256_atual: string | null };
async function plano() {
  return JSON.parse(await readFile(new URL("../docs/auditorias/migrations-2026-10-29/alteracoes-arquivos.json", import.meta.url), "utf8")) as Entrada[];
}
async function sqlMigration(nome: string) {
  return readFile(new URL(`../prisma/migrations/${nome}/migration.sql`, import.meta.url), "utf8");
}
async function base() {
  const db = criarPostgresMemoria();
  await db.exec(await readFile(new URL("./fixtures/migrations-parciais-base.sql", import.meta.url), "utf8"));
  return db;
}
async function deveFalhar(db: BancoMemoria, sql: string, codigo: string) {
  await assert.rejects(db.query(sql), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === codigo);
}

test("19 correções são repetíveis, preservam dados e protegem integridade e acesso no PostgreSQL isolado", async (t) => {
  const db = await base();
  t.after(() => db.close());
  await db.exec(`INSERT INTO aplicativo VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO estampas (id,processing_status) VALUES (1,'COMPLETED');
    INSERT INTO estampa_jobs (estampa_id,provider_custom_id) VALUES (1,'batch-original');
    INSERT INTO notification (tentativas) VALUES (2);
    INSERT INTO pedido_fornecedor_queue (dados_pedido) VALUES ('{"preservar":true}');
    INSERT INTO itens_retorno_estoque_olist (quantidade,movimentacao_id) VALUES (2,NULL);
    INSERT INTO estampa (codigo,variante) VALUES ('1',NULL),('1','A');`);
  const antes = (await db.query("SELECT id,estampa_id,provider_custom_id,status FROM estampa_jobs")).rows;
  const funcaoAntes = (await db.query("SELECT pg_get_functiondef('buscar_estampas_por_relevancia(text,integer,integer)'::regprocedure) AS definicao")).rows;
  const correcoes = (await plano()).filter((item) => item.acao === "ajustada");
  assert.equal(correcoes.length, 19);
  for (let rodada = 0; rodada < 2; rodada++) {
    for (const item of correcoes) await db.exec(await sqlMigration(item.migration));
  }
  assert.deepEqual((await db.query("SELECT id,estampa_id,provider_custom_id,status FROM estampa_jobs")).rows, antes);
  assert.deepEqual((await db.query("SELECT pg_get_functiondef('buscar_estampas_por_relevancia(text,integer,integer)'::regprocedure) AS definicao")).rows, funcaoAntes);
  assert.equal((await db.query<{ quantidade: number }>("SELECT quantidade FROM itens_retorno_estoque_olist")).rows[0].quantidade, 2);
  assert.deepEqual((await db.query("SELECT dados_pedido FROM pedido_fornecedor_queue")).rows[0].dados_pedido, { preservar: true });

  await t.test("FKs e índices únicos impedem órfãos e duplicatas sem perder evolução de jobs", async () => {
    await deveFalhar(db, "INSERT INTO estampa_jobs(estampa_id) VALUES(99)", "23503");
    await deveFalhar(db, "INSERT INTO estampa_jobs(estampa_id,provider_custom_id) VALUES(1,'batch-original')", "23505");
    await deveFalhar(db, "INSERT INTO estampa(codigo) VALUES('1')", "23505");
    await deveFalhar(db, "INSERT INTO estampa(codigo,variante) VALUES('1','A')", "23505");
    await db.query("INSERT INTO estampa(codigo,variante) VALUES('1','B')");
    await db.query("INSERT INTO estampa_jobs(estampa_id,provider_custom_id) VALUES(1,NULL),(1,NULL)");
    await deveFalhar(db, "INSERT INTO itens_solicitacao_devolucao(solicitacao_id) VALUES(gen_random_uuid())", "23503");
  });
  await t.test("checks rejeitam dados inválidos e permitem perda sem movimento", async () => {
    for (const sql of ["INSERT INTO notification(tentativas) VALUES(-1)", "INSERT INTO acesso_pagina_usuario VALUES(gen_random_uuid(),'/',0)", "INSERT INTO pedido_fornecedor_queue(versao) VALUES(-1)", "INSERT INTO pedido_fornecedor_queue(aplicativo_filial_id) VALUES('00000000-0000-0000-0000-000000000001')", "INSERT INTO solicitacoes_producao(evidencia_url) VALUES('https://example.test')", "INSERT INTO itens_retorno_estoque_olist(quantidade) VALUES(0)"]) await deveFalhar(db, sql, "23514");
    await db.query("INSERT INTO itens_retorno_estoque_olist(quantidade,movimentacao_id) VALUES(1,NULL)");
  });
  await t.test("arrays são obrigatórios e defaults de atualização continuam disponíveis", async () => {
    for (const [tabela, campo] of [["tarefas_midia", "dias_semana"], ["buscas_sku", "situacoes"]]) await deveFalhar(db, `INSERT INTO ${tabela}(${campo}) VALUES(NULL)`, "23502");
    await deveFalhar(db, "INSERT INTO configuracoes_jobs VALUES('teste',NULL)", "23502");
    for (const tabela of ["tipo_produto", "variante", "tamanho", "produto_olist"]) assert.ok((await db.query(`INSERT INTO ${tabela} DEFAULT VALUES RETURNING updated_at`)).rows[0].updated_at);
  });
  await t.test("tabelas servidoras e turnos não permitem acesso direto de anon/authenticated", async () => {
    for (const tabela of ["turnos_producao", "notification", "acesso_pagina_usuario", "pedido_fornecedor_queue", "retornos_estoque_olist", "itens_retorno_estoque_olist"]) {
      assert.equal((await db.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid=$1::regclass", [tabela])).rows[0].rls, true);
      for (const papel of ["anon", "authenticated"]) {
        assert.equal((await db.query<{ permitido: boolean }>("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS permitido", [papel, tabela])).rows[0].permitido, false);
      }
    }
    await db.exec("SET ROLE anon");
    await deveFalhar(db, "SELECT * FROM notification", "42501");
    await db.exec("RESET ROLE");
    assert.equal((await db.query<{ permitido: boolean }>("SELECT has_function_privilege('anon','buscar_estampas_por_relevancia(text,integer,integer)','EXECUTE') AS permitido")).rows[0].permitido, false);
    assert.equal((await db.query<{ permitido: boolean }>("SELECT has_function_privilege('authenticated','buscar_estampas_por_relevancia(text,integer,integer)','EXECUTE') AS permitido")).rows[0].permitido, true);
  });
});

test("dados existentes inválidos abortam a correção inteira sem serem apagados ou convertidos", async (t) => {
  for (const [prefixo, preparar, tabela] of [
    ["20261002120000", "INSERT INTO notification(tentativas) VALUES(-1)", "notification"],
    ["20260827110000", "INSERT INTO estampa(codigo) VALUES('duplicado'),('duplicado')", "estampa"],
    ["20260722120000", "INSERT INTO buscas_sku(situacoes) VALUES(NULL)", "buscas_sku"],
  ]) {
    await t.test(prefixo, async () => {
      const db = await base();
      try {
        await db.exec(preparar);
        const arquivo = (await plano()).find((item) => item.migration.startsWith(prefixo))!;
        await assert.rejects(db.exec(await sqlMigration(arquivo.migration)));
        await db.exec("ROLLBACK");
        assert.ok(Number((await db.query<{ total: string }>(`SELECT count(*) AS total FROM ${tabela}`)).rows[0].total) > 0);
        assert.equal((await db.query<{ rls: boolean }>("SELECT relrowsecurity AS rls FROM pg_class WHERE oid=$1::regclass", [tabela])).rows[0].rls, false);
      } finally { await db.close(); }
    });
  }
});
