import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

test("ações de importação validam sessão, permissão, aplicativo, limites e revalidam produtos ao salvar", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";process.env.SUPABASE_SERVICE_ROLE_KEY="fake";
  const app="00000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000001";
  let permitido=true,ativo=true,disponivel=true,falha=false,transacoes=0;
  const sqls:Prisma.Sql[]=[];
  type Tx={ $queryRaw:(q:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>Promise<{id:string}[]>; $executeRaw:(q:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>Promise<number> };
  const cliente={
    usuario:{findFirst:async()=>({id:"usuario",aplicativoId:app,ativo,podeVisualizarTarefasMidia:permitido})},
    produto:{findMany:async(args:{where:{aplicativoId:string;ativo?:boolean};select:unknown;take:number})=>{
      assert.equal(args.where.aplicativoId,app);assert.ok(args.take<=500);
      if(args.where.ativo){assert.deepEqual(args.select,{id:true});return disponivel?[{id}]:[];}
      return [{id,sku:"001",ativo:true}];
    }},
    $queryRaw:async(q:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>{
      const sql=Array.isArray(q)?Prisma.sql(q as TemplateStringsArray,...valores):q as Prisma.Sql;sqls.push(sql);
      if(sql.text.includes("ORDER BY id FOR UPDATE"))return disponivel?[{id,sku:"001",ativo:true}]:[];
      return [];
    },
    $executeRaw:async(q:Prisma.Sql|TemplateStringsArray,...valores:unknown[])=>{sqls.push(Array.isArray(q)?Prisma.sql(q as TemplateStringsArray,...valores):q as Prisma.Sql);if(falha)throw new Error("secret SQL");return 1;},
    async $transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{transacoes++;return fn(cliente);},
  };
  Object.assign(globalThis,{prisma:cliente});
  const {supabaseAdmin}=await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth,"getUser",async(token:string)=>{if(token==="bad")throw new Error("secret auth");return {data:{user:{id:"usuario",email:"teste@example.test"}},error:null};});
  const {validarImportacaoCalendario,importarLoteCalendario,importarArquivoCalendario}=await import("../src/app/controle-midia/calendario/actions");
  const lote={eventoId:"natal",skus:["001"]};
  for(const token of ["","bad"]){assert.equal((await importarLoteCalendario(token,lote)).ok,false);}
  permitido=false;assert.equal((await importarLoteCalendario("token",lote)).ok,false);permitido=true;
  ativo=false;assert.equal((await importarLoteCalendario("token",lote)).ok,false);ativo=true;
  assert.equal(transacoes,0);
  for(const entrada of [{...lote,aplicativoId:"alheio"},{...lote,eventoId:"errado"},{...lote,skus:["001","001"]},{...lote,skus:Array.from({length:101},(_,i)=>String(i))}])assert.equal((await importarLoteCalendario("token",entrada)).ok,false);
  disponivel=false;assert.equal((await importarLoteCalendario("token",lote)).ok,false);assert.equal(transacoes,0);disponivel=true;
  assert.deepEqual(await importarLoteCalendario("token",lote),{ok:true,processados:1});assert.equal(transacoes,1);
  assert.ok(sqls.some(q=>/ON CONFLICT/.test(q.text)));assert.ok(sqls.some(q=>/FOR UPDATE/.test(q.text)));assert.ok(sqls.some(q=>q.values.includes(app)));
  falha=true;const erro=await importarLoteCalendario("token",lote);assert.equal(erro.ok,false);assert.doesNotMatch(JSON.stringify(erro),/secret SQL/);falha=false;
  const entrada={linhas:[{registro:2,sku:"001",principal:"natal",adicionais:"",tipo:"Direta"}],incluirSugestoes:false,incluirAdicionais:false};
  assert.equal((await validarImportacaoCalendario("token",entrada)).ok,true);
  assert.equal((await validarImportacaoCalendario("token",{...entrada,aplicativoId:"alheio"})).ok,false);
  const arquivo={vinculos:[{sku:"001",eventoId:"natal"}]};
  assert.equal((await importarArquivoCalendario("bad",arquivo)).ok,false);
  permitido=false;assert.equal((await importarArquivoCalendario("token",arquivo)).ok,false);permitido=true;
  assert.equal((await importarArquivoCalendario("token",{...arquivo,aplicativoId:"alheio"})).ok,false);
  assert.deepEqual(await importarArquivoCalendario("token",arquivo),{ok:true,processados:1,adicionados:1});

});
