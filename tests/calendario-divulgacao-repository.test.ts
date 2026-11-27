import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

const comandos: string[]=[];
let opcoes: unknown;
let sqlConsulta: Prisma.Sql | undefined;
Object.assign(globalThis,{prisma:{
  async $transaction<T>(executar:(tx:{
    $executeRaw:(texto:TemplateStringsArray)=>Promise<number>;
    $queryRaw:(sql:Prisma.Sql)=>Promise<unknown[]>;
  })=>Promise<T>,limites:unknown){
    opcoes=limites;
    return executar({
      async $executeRaw(texto){comandos.push(texto.join(""));return 0;},
      async $queryRaw(sql){sqlConsulta=sql;return [{id:null,referenciaEm:new Date("2026-11-27T12:00Z"),inicioEm:new Date("2025-11-27T12:00Z")}];},
    });
  },
}});
test("repositório limita statement e transação, não faz leituras N+1 e preserva o vazio",async()=>{
  const {listarDivulgacao}=await import("../src/lib/calendario-comercial/divulgacao-repository");
  const resultado=await listarDivulgacao("00000000-0000-4000-8000-000000000001",[],0);
  assert.deepEqual(comandos,["SET TRANSACTION READ ONLY","SET LOCAL statement_timeout = '5s'"]);
  assert.deepEqual(opcoes,{maxWait:5000,timeout:8000});
  assert.ok(sqlConsulta);assert.match(sqlConsulta.text,/WITH parametros AS/);
  assert.deepEqual(resultado.produtos,[]);assert.equal(resultado.temMais,false);
});
