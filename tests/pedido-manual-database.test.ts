import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
test("migration mantém produção, exige identidade manual, garante unicidade e fecha a tabela de reservas", async () => {
  const db = criarPostgresMemoria();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE usuario(id uuid PRIMARY KEY);
      CREATE TABLE aplicativo(id uuid PRIMARY KEY);
      CREATE TABLE pedido_fornecedor_queue(id uuid PRIMARY KEY, aplicativo_solicitante_id uuid NOT NULL,
        aplicativo_fornecedor_id uuid NOT NULL, solicitacao_producao_id uuid NOT NULL UNIQUE,
        fornecedor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`);
    await db.query("INSERT INTO usuario VALUES ($1),($2)",[id(1),id(2)]);
    await db.query("INSERT INTO pedido_fornecedor_queue(id,aplicativo_solicitante_id,aplicativo_fornecedor_id,solicitacao_producao_id,fornecedor_id) VALUES ($1,$2,$3,$4,$5)",[id(10),id(20),id(30),id(40),id(50)]);
    await db.exec(await readFile(new URL("../prisma/migrations/20261125010000_pedidos_manuais_fila/migration.sql",import.meta.url),"utf8"));
    assert.equal((await db.query<{tipo_origem:string}>("SELECT tipo_origem FROM pedido_fornecedor_queue")).rows[0].tipo_origem,"PRODUCAO");
    const insert = (fila:string,autor:string,origem="MANUAL",app=id(20),solicitacao:string|null=null) => db.query(`INSERT INTO pedido_fornecedor_queue
      (id,aplicativo_solicitante_id,aplicativo_fornecedor_id,tipo_origem,autor_id,chave_idempotencia,hash_entrada,solicitacao_producao_id)
      VALUES ($1,$2,$3,$4,$5,$6,'hash',$7)`,[fila,id(20),app,origem,autor,id(60),solicitacao]);
    await insert(id(11),id(1));
    await assert.rejects(insert(id(12),id(1)), /unique/i);
    await insert(id(13),id(2));
    await assert.rejects(insert(id(14),id(2),"MANUAL",id(30)), /ck_fila_origem/);
    await assert.rejects(insert(id(15),id(2),"PRODUCAO"), /ck_fila_origem/);
    await assert.rejects(insert(id(16),id(2),"MANUAL",id(20),id(41)), /ck_fila_origem/);
    await assert.rejects(insert(id(17),id(2),"OUTRA"), /ck_fila_origem/);
    for (const role of ["anon","authenticated"]) {
      const result = await db.query<{permitido:boolean}>("SELECT has_table_privilege($1,'envio_pedido_manual','SELECT') AS permitido",[role]);
      assert.equal(result.rows[0].permitido,false);
    }
    assert.equal((await db.query<{rls:boolean}>("SELECT relrowsecurity AS rls FROM pg_class WHERE relname='envio_pedido_manual'")).rows[0].rls,true);
  } finally { await db.close(); }
});
