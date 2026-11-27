import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";

const caminho = new URL("../prisma/migrations/20261125211000_unificacao_recebimento/migration.sql", import.meta.url);
async function preparar() {
  const db = criarPostgresMemoria();
  await db.exec(`CREATE TABLE usuario(id int, pode_visualizar_olist_formas_pagamento boolean);
    CREATE TABLE forma_pagamento_olist_plano(id int, plano_id int);
    CREATE TABLE olist_sync_execucao(status text);
    CREATE TABLE olist_sync_configuracao(id int, entidades text[] DEFAULT ARRAY['FORMA_PAGAMENTO'], ativo boolean, versao int, readiness_json jsonb, updated_at timestamptz);
    CREATE TABLE olist_sync_cobertura(configuracao_id int, completa_em timestamptz, watermark_confirmado timestamptz, incremental_validado boolean, incremental_validado_em timestamptz, geracao int, updated_at timestamptz);
    INSERT INTO usuario VALUES (1,true);
    INSERT INTO forma_pagamento_olist_plano VALUES (1,10);
    INSERT INTO olist_sync_configuracao VALUES (1,ARRAY['FORMA_PAGAMENTO','PRODUTO'],true,2,'{"pronta":true}',now()),(2,ARRAY['FORMA_PAGAMENTO'],true,3,'{}',now()),(3,ARRAY['CONTATO'],true,4,'{"pronta":true}',now());
    INSERT INTO olist_sync_cobertura VALUES (1,now(),now(),true,now(),5,now()),(3,now(),now(),true,now(),6,now());`);
  return db;
}
test("migration compatível preserva legado e ajusta somente configurações de pagamento", async () => {
  const db = await preparar();
  try {
    await db.exec(await readFile(caminho, "utf8"));
    assert.deepEqual((await db.query("SELECT * FROM forma_pagamento_olist_plano")).rows, [{ id:1, plano_id:10 }]);
    assert.deepEqual((await db.query("SELECT * FROM usuario")).rows, [{ id:1, pode_visualizar_olist_formas_pagamento:true }]);
    assert.deepEqual((await db.query("SELECT entidades, ativo, versao FROM olist_sync_configuracao ORDER BY id")).rows, [
      { entidades:["PRODUTO"],ativo:true,versao:3 }, { entidades:[],ativo:false,versao:4 }, { entidades:["CONTATO"],ativo:true,versao:4 },
    ]);
    assert.deepEqual((await db.query("SELECT geracao, incremental_validado FROM olist_sync_cobertura ORDER BY configuracao_id")).rows, [{geracao:6,incremental_validado:false},{geracao:6,incremental_validado:true}]);
    await db.exec("INSERT INTO olist_sync_configuracao(id) VALUES(4)");
    assert.deepEqual((await db.query("SELECT entidades FROM olist_sync_configuracao WHERE id=4")).rows[0], {entidades:["PRODUTO","CONTATO","VENDEDOR"]});
  } finally { await db.close(); }
});
test("execução ativa aborta atomicamente; exclusão manual mantém confirmação obrigatória", async () => {
  const db = await preparar();
  try {
    await db.exec("INSERT INTO olist_sync_execucao VALUES ('APLICANDO')");
    await assert.rejects(db.exec(await readFile(caminho,"utf8")), /Aguarde a conclusão/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT versao FROM olist_sync_configuracao WHERE id=1")).rows, [{versao:2}]);
    const manual = await readFile(new URL("../scripts/sql/contrair-recebimento-legado.sql", import.meta.url),"utf8");
    await assert.rejects(db.exec(manual), /Confirme backup/);
    await db.exec("ROLLBACK");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM forma_pagamento_olist_plano")).rows[0].n,1);
  } finally { await db.close(); }
});
