import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const pai = id(1), filhoA = id(2), filhoB = id(3), alheio = id(4), neto = id(5), usuarioId = id(6);

test("vendedores por conta: migração, ponte, hierarquia, versão e escrita final", async (t) => {
  const db = criarPostgresMemoria();
  const modoAnterior = process.env.OLIST_VENDEDORES_COMPAT_LEGADO;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE aplicativo(id uuid PRIMARY KEY, nome text NOT NULL, aplicativo_pai_id uuid REFERENCES aplicativo(id));
      CREATE TABLE usuario(id uuid PRIMARY KEY, aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), vendedor_olist_id integer);
      CREATE TABLE fornecedores(id uuid PRIMARY KEY, vendedor_olist_id uuid REFERENCES usuario(id), meu_cliente_olist_id integer,
        aplicativo_id uuid, aplicativo_pai_id uuid);
      CREATE TABLE envio_fornecedor(fila_id uuid,estado text);
      CREATE TABLE pedido_fornecedor_queue(id uuid PRIMARY KEY, tipo_origem text, fornecedor_id uuid,
        solicitacao_producao_id uuid, autor_id uuid, chave_idempotencia uuid, hash_entrada text,
        aplicativo_solicitante_id uuid, aplicativo_fornecedor_id uuid,
        CONSTRAINT ck_fila_origem CHECK(true));
      CREATE TABLE pedido_fornecedor_solicitacao(id uuid PRIMARY KEY, fornecedor_id uuid);
      CREATE TABLE produtos_fornecedor(id uuid PRIMARY KEY, fornecedor_id uuid);
    `);
    await db.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Matriz'),($2,'Alheio')", [pai, alheio]);
    await db.query("INSERT INTO aplicativo VALUES ($1,'A',$3),($2,'B',$3),($4,'Neto',$1)", [filhoA, filhoB, pai, neto]);
    await db.query("INSERT INTO usuario VALUES ($1,$2,100)", [usuarioId,pai]);
    await db.exec(await readFile(new URL("../prisma/migrations/20261124223231_usuario_vendedor_olist/migration.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../prisma/migrations/20261125183000_vendedores_fornecedores_externos/migration.sql", import.meta.url), "utf8"));
    const linhas = () => db.query<{ aplicativo_id: string; vendedor_olist_id: number }>(
      "SELECT aplicativo_id,vendedor_olist_id FROM usuario_vendedor_olist WHERE usuario_id=$1 ORDER BY aplicativo_id", [usuarioId]);
    assert.deepEqual((await linhas()).rows, [{ aplicativo_id:pai,vendedor_olist_id:100 }]);
    assert.deepEqual((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='usuario_vendedor_olist'")).rows, [{relrowsecurity:true}]);
    for (const role of ["anon","authenticated"]) {
      assert.equal((await db.query<{ permitido:boolean }>("SELECT has_table_privilege($1,'usuario_vendedor_olist','SELECT') AS permitido",[role])).rows[0].permitido,false);
    }
    await assert.rejects(db.query("INSERT INTO usuario_vendedor_olist VALUES ($1,$2,0,now(),now())",[usuarioId,filhoA]));
    for (const conta of [alheio,neto]) await assert.rejects(db.query("INSERT INTO usuario_vendedor_olist VALUES ($1,$2,200,now(),now())",[usuarioId,conta]), /filho direto/);

    const sql = (consulta: Prisma.Sql | TemplateStringsArray, valores: unknown[]) => "text" in consulta
      ? consulta : Prisma.sql(consulta, ...valores);
    const tx = {
      $queryRaw: async (consulta: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]) => {
        const query = sql(consulta,valores); return (await db.query(query.text,query.values)).rows;
      },
      $executeRaw: async (consulta: TemplateStringsArray,...valores: unknown[]) => {
        const query = sql(consulta,valores); await db.query(query.text,query.values); return 1;
      },
      usuario: { findUniqueOrThrow: async () => (await db.query('SELECT vinculos_olist_versao AS "vinculosOlistVersao" FROM usuario WHERE id=$1',[usuarioId])).rows[0] },
      usuarioVendedorOlist: {
        deleteMany: async ({where}: {where:{usuarioId:string;aplicativoId:string | {not:string;notIn:string[]}}}) => {
          if (typeof where.aplicativoId === "string") await db.query("DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id=$2",[where.usuarioId,where.aplicativoId]);
          else await db.query("DELETE FROM usuario_vendedor_olist WHERE usuario_id=$1 AND aplicativo_id<>$2 AND NOT(aplicativo_id=ANY($3::uuid[]))",[where.usuarioId,where.aplicativoId.not,where.aplicativoId.notIn]);
          return {count:0};
        },
        upsert: async ({create}: {create:{usuarioId:string;aplicativoId:string;vendedorOlistId:number}}) => {
          await db.query("INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id) VALUES ($1,$2,$3) ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id",[create.usuarioId,create.aplicativoId,create.vendedorOlistId]);
        },
        findFirst: async ({where,select}: {where:{usuarioId:string;aplicativoId:string};select:unknown}) => {
          assert.deepEqual(select,{vendedorOlistId:true});
          return (await db.query('SELECT v.vendedor_olist_id AS "vendedorOlistId" FROM usuario_vendedor_olist v JOIN usuario u ON u.id=v.usuario_id JOIN aplicativo a ON a.id=v.aplicativo_id WHERE v.usuario_id=$1 AND v.aplicativo_id=$2 AND (u.aplicativo_id=a.id OR u.aplicativo_id=a.aplicativo_pai_id)',[where.usuarioId,where.aplicativoId])).rows[0] ?? null;
        },
      },
    };
    Object.assign(globalThis,{prisma:tx});
    const {substituirVendedoresOlist,alterarVendedorOlistLegado,obterVendedorDoUsuario} = await import("../src/lib/usuario-vendedor-olist");
    const transaction = async <T,>(operar:()=>Promise<T>) => {
      await db.exec("BEGIN"); try { const resultado = await operar(); await db.exec("COMMIT"); return resultado; }
      catch(error) { await db.exec("ROLLBACK"); throw error; }
    };
    const client = tx as unknown as Prisma.TransactionClient;
    process.env.OLIST_VENDEDORES_COMPAT_LEGADO="true";
    const versao = await transaction(()=>substituirVendedoresOlist(client,usuarioId,pai,[{aplicativoId:pai,vendedorOlistId:101},{aplicativoId:filhoA,vendedorOlistId:200},{aplicativoId:filhoB,vendedorOlistId:300}],0));
    assert.ok(versao>0);
    assert.equal(await obterVendedorDoUsuario(usuarioId,filhoA),200);
    assert.equal(await obterVendedorDoUsuario(usuarioId,alheio),null);
    assert.equal((await linhas()).rows.length,3);
    await assert.rejects(transaction(()=>substituirVendedoresOlist(client,usuarioId,pai,[],0)),/Recarregue/);
    assert.equal((await linhas()).rows.length,3);
    await assert.rejects(db.query("UPDATE aplicativo SET aplicativo_pai_id=$1 WHERE id=$2",[alheio,filhoA]), /Remova vínculos/);
    await assert.rejects(db.query("UPDATE usuario SET aplicativo_id=$1 WHERE id=$2",[alheio,usuarioId]), /vendedor legado|Remova vínculos/);
    await transaction(()=>alterarVendedorOlistLegado(client,usuarioId,pai,null));
    assert.deepEqual((await linhas()).rows.map(x=>x.aplicativo_id),[filhoA,filhoB]);
    await db.query("UPDATE usuario SET vendedor_olist_id=102 WHERE id=$1",[usuarioId]);
    assert.equal(await obterVendedorDoUsuario(usuarioId,pai),102);
    const segundo = id(7);
    await db.query("INSERT INTO usuario VALUES ($1,$2,102,0)",[segundo,pai]);
    assert.equal(await obterVendedorDoUsuario(segundo,pai),102,"vendedor compartilhado entre usuários é permitido");
    const usuarioFilho = id(8);
    await db.query("INSERT INTO usuario VALUES ($1,$2,400,0)",[usuarioFilho,filhoA]);
    await assert.rejects(db.query("UPDATE usuario SET aplicativo_id=$1 WHERE id=$2",[pai,usuarioFilho]),/vendedor legado/,
      "subir do filho para o pai não pode reinterpretar o escalar na conta do pai");
    assert.equal(await obterVendedorDoUsuario(usuarioFilho,filhoA),400);
    assert.equal(await obterVendedorDoUsuario(usuarioFilho,pai),null);
    const usuarioIsolado = id(9);
    await db.query("INSERT INTO usuario VALUES ($1,$2,600,0)",[usuarioIsolado,alheio]);
    assert.equal(await obterVendedorDoUsuario(usuarioIsolado,alheio),600,"conta independente mantém cenário 1:1");
    assert.equal(await obterVendedorDoUsuario(usuarioIsolado,filhoA),null);

    process.env.OLIST_VENDEDORES_COMPAT_LEGADO="false";
    const atual = Number((await db.query<{versao:number}>("SELECT vinculos_olist_versao AS versao FROM usuario WHERE id=$1",[usuarioId])).rows[0].versao);
    await transaction(()=>substituirVendedoresOlist(client,usuarioId,pai,[],atual));
    assert.deepEqual((await linhas()).rows,[]);
    await db.query("INSERT INTO envio_fornecedor VALUES (null,'INCERTO')");
    await db.query("INSERT INTO fornecedores(id,vendedor_olist_id,meu_cliente_olist_id) VALUES ($1,$2,700)",[id(10),usuarioId]);
    const antesContracao = await db.query("SELECT usuario_id,aplicativo_id,vendedor_olist_id FROM usuario_vendedor_olist ORDER BY usuario_id,aplicativo_id");
    const contracao = await readFile(new URL("../prisma/migrations/20261124230059_remove_usuario_vendedor_olist/migration.sql",import.meta.url),"utf8");
    await assert.rejects(db.exec(contracao),/Concilie/); await db.exec("ROLLBACK");
    await db.exec("DELETE FROM envio_fornecedor");
    await db.exec(contracao);
    assert.deepEqual((await db.query("SELECT usuario_id,aplicativo_id,vendedor_olist_id FROM usuario_vendedor_olist ORDER BY usuario_id,aplicativo_id")).rows,antesContracao.rows,
      "contração não recria vínculos removidos nem modifica os IDs normalizados");
    assert.deepEqual((await db.query("SELECT vendedor_olist_id,meu_cliente_olist_id FROM fornecedores WHERE id=$1",[id(10)])).rows,
      [{vendedor_olist_id:usuarioId,meu_cliente_olist_id:700}],"migration não altera o campo do fornecedor");
    assert.equal((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='usuario' AND column_name='vendedor_olist_id'")).rows.length,0);
    // Regressão do formulário após aplicar a contração: sem env e com env=true
    // antigo, salvar somente os IDs dos filhos não pode consultar a coluna removida.
    for (const modo of [undefined,"true"]) {
      if (modo === undefined) delete process.env.OLIST_VENDEDORES_COMPAT_LEGADO;
      else process.env.OLIST_VENDEDORES_COMPAT_LEGADO=modo;
      const versaoFilhos = Number((await db.query<{versao:number}>("SELECT vinculos_olist_versao AS versao FROM usuario WHERE id=$1",[usuarioId])).rows[0].versao);
      await transaction(()=>substituirVendedoresOlist(client,usuarioId,pai,[
        {aplicativoId:filhoA,vendedorOlistId:345005007},
        {aplicativoId:filhoB,vendedorOlistId:366550419},
      ],versaoFilhos));
      assert.deepEqual((await linhas()).rows,[
        {aplicativo_id:filhoA,vendedor_olist_id:345005007},
        {aplicativo_id:filhoB,vendedor_olist_id:366550419},
      ]);
    }
    await transaction(()=>alterarVendedorOlistLegado(client,usuarioId,pai,999));
    assert.equal(await obterVendedorDoUsuario(usuarioId,pai),999,"formato legado também funciona após remover a coluna sem depender da flag");
    const versaoFinal = Number((await db.query<{versao:number}>("SELECT vinculos_olist_versao AS versao FROM usuario WHERE id=$1",[usuarioId])).rows[0].versao);
    await transaction(()=>substituirVendedoresOlist(client,usuarioId,pai,[],versaoFinal));
    await transaction(()=>alterarVendedorOlistLegado(client,usuarioId,pai,null));
    await db.query("UPDATE usuario SET aplicativo_id=$1 WHERE id=$2",[alheio,usuarioId]);
    assert.equal(await obterVendedorDoUsuario(usuarioId,pai),null,"proteção de hierarquia continua funcionando sem a coluna antiga");
    await t.test("schema de entrada rejeita duplicidades e IDs fora de INTEGER", async()=>{
      const {vendedorOlistEntradaSchema}=await import("../src/lib/usuario-vendedor-olist");
      assert.equal(vendedorOlistEntradaSchema.safeParse([{aplicativoId:pai,vendedorOlistId:1},{aplicativoId:pai,vendedorOlistId:2}]).success,false);
      assert.equal(vendedorOlistEntradaSchema.safeParse([{aplicativoId:pai,vendedorOlistId:2147483648}]).success,false);
    });
  } finally {
    if(modoAnterior===undefined) delete process.env.OLIST_VENDEDORES_COMPAT_LEGADO; else process.env.OLIST_VENDEDORES_COMPAT_LEGADO=modoAnterior;
    await db.close();
  }
});

test("remoção aborta sem expansão e preserva a coluna antiga", async () => {
  const db = criarPostgresMemoria();
  try {
    await db.exec("CREATE TABLE usuario(id uuid PRIMARY KEY,vendedor_olist_id integer)");
    const migration = await readFile(new URL("../prisma/migrations/20261124230059_remove_usuario_vendedor_olist/migration.sql",import.meta.url),"utf8");
    await assert.rejects(db.exec(migration),/Aplique a expansão/);
    await db.exec("ROLLBACK");
    await db.query("INSERT INTO usuario VALUES ($1,123)",[usuarioId]);
    assert.deepEqual((await db.query("SELECT vendedor_olist_id FROM usuario")).rows,[{vendedor_olist_id:123}]);
  } finally { await db.close(); }
});
