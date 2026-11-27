import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
const app="00000000-0000-4000-8000-000000000001";
const chamadas: { where: { aplicativoId: string; sku: { in: string[] } }; select: unknown; take: number }[]=[];
const sqls: Prisma.Sql[]=[];
Object.assign(globalThis,{prisma:{produto:{findMany:async(args:typeof chamadas[number])=>{chamadas.push(args);return args.where.sku.in.map((sku,i)=>({id:`10000000-0000-4000-8000-${String(chamadas.length*1000+i).padStart(12,"0")}`,sku,ativo:true}));}},$queryRaw:async(q:Prisma.Sql)=>{sqls.push(q);return [];}}});
test("prévia usa lotes de 500, projeção mínima, escopo e somente pares solicitados", async()=>{
  const {previaImportacaoCalendario}=await import("../src/lib/calendario-comercial/importacao-repository");
  const r=await previaImportacaoCalendario(app,{incluirAdicionais:false,incluirSugestoes:false,linhas:Array.from({length:1001},(_,i)=>({registro:i+2,sku:String(i),principal:"natal",adicionais:"",tipo:"Direta"}))});
  assert.equal(r.vinculos.length,1001);assert.deepEqual(chamadas.map(c=>c.where.sku.in.length),[500,500,1]);assert.equal(sqls.length,3);
  for(const c of chamadas){assert.equal(c.where.aplicativoId,app);assert.deepEqual(c.select,{id:true,sku:true,ativo:true});assert.equal(c.take,500);}
  for(const q of sqls){assert.match(q.text,/aplicativo_id = \$\d+::uuid/);assert.match(q.text,/\(produto_id, evento_id\) IN/);assert.match(q.text,/LIMIT 500/);assert.doesNotMatch(q.text,/SELECT \*|titulo|imagem|descricao/);assert.ok(q.values.includes(app));}
  const db=criarPostgresMemoria();
  try {
    await db.exec("CREATE TABLE calendario_evento_produtos(aplicativo_id uuid,produto_id uuid,evento_id varchar(100))");
    const produto="10000000-0000-4000-8000-000000001000";
    await db.query("INSERT INTO calendario_evento_produtos VALUES ($1,$2,'natal'),($1,$2,'advento'),('00000000-0000-4000-8000-000000000002',$2,'natal')",[app,produto]);
    const dados=await db.query(sqls[0].text,sqls[0].values);
    assert.deepEqual(dados.rows,[{produtoId:produto,eventoId:"natal"}]);
  } finally {await db.close();}
});
