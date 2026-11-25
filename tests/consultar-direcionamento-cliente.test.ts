import test from "node:test";
import assert from "node:assert/strict";
import { consultarDirecionamentoCliente } from "../src/lib/consultar-direcionamento-cliente";
test("recupera falha temporária com backoff limitado",async()=>{
 let chamadas=0;const esperas:number[]=[];
 const d=await consultarDirecionamentoCliente("/teste","token",new AbortController().signal,{fetch:async()=>{chamadas++;return chamadas<3?Response.json({error:"Temporário"},{status:503}):Response.json({destino:"filial"});},aguardar:async ms=>{esperas.push(ms);}});
 assert.deepEqual(d,{destino:"filial"});assert.equal(chamadas,3);assert.deepEqual(esperas,[1000,2000]);
});
test("não repete falhas de permissão ou regra de negócio",async()=>{
 for(const status of [400,401,403,404,409]){let chamadas=0;await assert.rejects(consultarDirecionamentoCliente("/teste","token",new AbortController().signal,{fetch:async()=>{chamadas++;return Response.json({error:"Bloqueado"},{status});},aguardar:async()=>{throw new Error("Não deve aguardar");}}),/Bloqueado/);assert.equal(chamadas,1);}
});
test("limita falhas de rede a três chamadas",async()=>{
 let chamadas=0;await assert.rejects(consultarDirecionamentoCliente("/teste","token",new AbortController().signal,{fetch:async()=>{chamadas++;throw new TypeError("Rede");},aguardar:async()=>{}}),/Rede/);assert.equal(chamadas,3);
});
test("cancelamento impede consulta de seleção antiga",async()=>{
 const c=new AbortController();let chamadas=0;await assert.rejects(consultarDirecionamentoCliente("/teste","token",c.signal,{fetch:async()=>{chamadas++;throw new TypeError("Rede");},aguardar:async()=>{c.abort();}}));assert.equal(chamadas,1);
});
