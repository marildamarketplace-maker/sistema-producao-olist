import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
import { importacaoCompletaSchema } from "../src/lib/calendario-comercial/importacao";

const app="00000000-0000-4000-8000-000000000001";
const outro="00000000-0000-4000-8000-000000000002";
const db=criarPostgresMemoria();
const sqls:Prisma.Sql[]=[];
function sql(q:Prisma.Sql|TemplateStringsArray,values:unknown[]){return Array.isArray(q)?Prisma.sql(q as TemplateStringsArray,...values):q as Prisma.Sql;}
type Tx={ $queryRaw:(q:Prisma.Sql|TemplateStringsArray,...values:unknown[])=>Promise<Record<string,unknown>[]>; $executeRaw:(q:Prisma.Sql|TemplateStringsArray,...values:unknown[])=>Promise<number> };
const cliente={
  async $queryRaw(q:Prisma.Sql|TemplateStringsArray,...values:unknown[]){const query=sql(q,values);sqls.push(query);return (await db.query(query.text,query.values)).rows;},
  async $executeRaw(q:Prisma.Sql|TemplateStringsArray,...values:unknown[]){
    const query=sql(q,values);sqls.push(query);
    const contar=async()=>Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM calendario_evento_produtos")).rows[0].n);
    const antes=await contar();await db.query(query.text,query.values);return await contar()-antes;
  },
  async $transaction<T>(fn:(tx:Tx)=>Promise<T>,opcoes:{maxWait:number;timeout:number}):Promise<T>{
    assert.deepEqual(opcoes,{maxWait:5000,timeout:20000});
    await db.exec("BEGIN");try{const r=await fn(cliente);await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}
  },
};
Object.assign(globalThis,{prisma:cliente});

test("importação integral: >100 vínculos, múltiplos eventos, rollback e repetição idempotente",async()=>{
  try {
    await db.exec(`CREATE TABLE produtos(id uuid PRIMARY KEY,aplicativo_id uuid,sku text,ativo boolean);
      CREATE TABLE calendario_evento_produtos(aplicativo_id uuid,evento_id text,produto_id uuid REFERENCES produtos(id),PRIMARY KEY(aplicativo_id,evento_id,produto_id));
      INSERT INTO produtos SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${app}','SKU-'||n,true FROM generate_series(1,140) n;`);
    const {salvarImportacaoCompleta}=await import("../src/lib/calendario-comercial/importacao-repository");
    const vinculos=Array.from({length:140},(_,i)=>[{sku:`SKU-${i+1}`,eventoId:"natal"},{sku:`SKU-${i+1}`,eventoId:"advento"}]).flat();
    assert.equal(importacaoCompletaSchema.safeParse({vinculos}).success,true);
    assert.deepEqual(await salvarImportacaoCompleta(app,vinculos),{processados:280,adicionados:280});
    assert.equal(sqls.filter(q=>q.text.includes("INSERT INTO")).length,1);
    assert.ok(sqls.some(q=>q.text.includes("ORDER BY chave")));
    assert.ok(sqls.some(q=>q.text.includes("ORDER BY id FOR UPDATE")));
    assert.deepEqual(await salvarImportacaoCompleta(app,vinculos),{processados:280,adicionados:0});
    await db.exec("UPDATE produtos SET ativo=false WHERE sku='SKU-140'");
    await assert.rejects(salvarImportacaoCompleta(app,vinculos.map(v=>({...v,eventoId:"primavera"}))),/indisponível/);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM calendario_evento_produtos WHERE evento_id='primavera'")).rows[0].n,0);
    await assert.rejects(salvarImportacaoCompleta(outro,vinculos),/indisponível/);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM calendario_evento_produtos")).rows[0].n,280);
    await db.exec("UPDATE produtos SET ativo=true");
    // Falha dentro do INSERT depois de validação: nenhum evento do arquivo pode persistir.
    await db.exec("ALTER TABLE calendario_evento_produtos ADD CONSTRAINT evento_proibido CHECK(evento_id <> 'pascoa')");
    await assert.rejects(salvarImportacaoCompleta(app,[{sku:"SKU-1",eventoId:"primavera"},{sku:"SKU-2",eventoId:"pascoa"}]));
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM calendario_evento_produtos WHERE evento_id='primavera'")).rows[0].n,0);
  }finally{await db.close();}
});
test("fronteira integral recusa duplicados, eventos falsos e excesso de vínculos",()=>{
  const v={sku:"001",eventoId:"natal"};
  for(const entrada of [{vinculos:[]},{vinculos:[v,v]},{vinculos:[{...v,eventoId:"inexistente"}]},{vinculos:[v],aplicativoId:outro},{vinculos:Array.from({length:10001},(_,i)=>({...v,sku:String(i)}))}])assert.equal(importacaoCompletaSchema.safeParse(entrada).success,false);
});
