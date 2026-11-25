import test from "node:test";
import assert from "node:assert/strict";
import {consultarPessoasDestinoFila} from "../src/lib/fila-pessoas-destino";
test("consulta IDs na conta destino e projeta somente dados da pessoa",async()=>{
 const chamadas:unknown[]=[];
 const resultado=await consultarPessoasDestinoFila("destino",30,20,{obter:async(app,recurso,id)=>{chamadas.push([app,recurso,id]);return {id,nome:id===30?"Cliente destino":"Vendedor destino",cpfCnpj:"documento",email:"teste@example.test",telefone:"123",senha:"secreto",historico:{privado:true}};},listar:async(app,filtro)=>{chamadas.push([app,filtro]);return {itens:[{id:20,contato:{id:40}}],paginacao:{limit:100,offset:0,total:1}};}});
 assert.equal(resultado.cliente.nome,"Cliente destino");assert.equal(resultado.vendedor?.nome,"Vendedor destino");
 assert.deepEqual(Object.keys(resultado.cliente).sort(),["documento","email","id","nome","telefone"]);
 assert.deepEqual(chamadas,[["destino","contatos",30],["destino",{limit:100,offset:0}],["destino","contatos",40]]);
});
test("limita páginas e não substitui vendedor ausente por outro cadastro",async()=>{
 let chamadas=0;const resultado=await consultarPessoasDestinoFila("destino",30,999,{obter:async()=>({id:30,nome:"Cliente"}),listar:async()=>{chamadas++;return {itens:Array.from({length:100},(_,id)=>({id})),paginacao:{limit:100,offset:0,total:500}};}});
 assert.equal(chamadas,4);assert.equal(resultado.vendedor,null);
});
