import test from "node:test";
import assert from "node:assert/strict";
import { consultarEstampasPedido } from "../src/lib/estampas-pedido";
test("pesquisa códigos com projeção mínima e paginação limitada",async()=>{
 let consulta: unknown;
 const resultado=await consultarEstampasPedido(new URLSearchParams({busca:" 684 ",pagina:"2"}),{estampaCatalogoIa:{findMany:async()=>[],groupBy:async args=>{consulta=args;return Array.from({length:21},(_,i)=>({codigo:`684${i}`}));}}});
 assert.ok(resultado.itens);
 assert.equal(resultado.itens.length,20);assert.equal(resultado.mais,true);
 assert.deepEqual(consulta,{where:{isActive:true,codigo:{startsWith:"684",mode:"insensitive"}},by:["codigo"],orderBy:{codigo:"asc"},take:21,skip:20});
});
test("código inexistente retorna vazio sem impedir uso manual",async()=>{
 assert.deepEqual(await consultarEstampasPedido(new URLSearchParams({busca:"INEXISTENTE"}),{estampaCatalogoIa:{groupBy:async()=>[],findMany:async()=>[]}}),{itens:[],mais:false});
});
test("rejeita páginas e buscas excessivas antes de consultar",async()=>{
 const db={estampaCatalogoIa:{groupBy:async()=>[],findMany:async()=>{throw new Error("Não deve consultar");}}};
 await assert.rejects(consultarEstampasPedido(new URLSearchParams({pagina:"0"}),db));
 await assert.rejects(consultarEstampasPedido(new URLSearchParams({busca:"a".repeat(101)}),db));
});
test("variante consulta somente a coluna variante para o código informado",async()=>{
 let consulta: unknown;
 const resultado=await consultarEstampasPedido(new URLSearchParams({campo:"variante",codigo:"6841",busca:"A"}),{estampaCatalogoIa:{findMany:async()=>[],groupBy:async args=>{consulta=args;return [{variante:"A"}];}}});
 assert.deepEqual(resultado,{itens:[{codigo:"A"}],mais:false});
 assert.deepEqual(consulta,{where:{isActive:true,codigo:{equals:"6841",mode:"insensitive"},variante:{not:null,startsWith:"A",mode:"insensitive"}},by:["variante"],orderBy:{variante:"asc"},take:21,skip:0});
});
test("variante sem código de estampa não consulta catálogo inteiro",async()=>{
 assert.deepEqual(await consultarEstampasPedido(new URLSearchParams({campo:"variante"}),{estampaCatalogoIa:{groupBy:async()=>[],findMany:async()=>{throw new Error("Consulta indevida");}}}),{itens:[],mais:false});
});
test("preview busca somente imagem da combinação exata",async()=>{
 let consulta: unknown;
 const resultado=await consultarEstampasPedido(new URLSearchParams({campo:"preview",codigo:"6841",variante:"B"}),{estampaCatalogoIa:{groupBy:async()=>[],findMany:async args=>{consulta=args;return [{previewUrl:"https://example.com/preview.webp"}];}}});
 assert.deepEqual(resultado,{previewUrl:"https://example.com/preview.webp"});
 assert.deepEqual(consulta,{where:{isActive:true,codigo:{equals:"6841",mode:"insensitive"},variante:{equals:"B",mode:"insensitive"}},select:{previewUrl:true},orderBy:{id:"asc"},take:1});
});
test("variante livre não possui preview",async()=>{
 assert.deepEqual(await consultarEstampasPedido(new URLSearchParams({campo:"preview",codigo:"6841",variante:"NOVA"}),{estampaCatalogoIa:{groupBy:async()=>[],findMany:async()=>[]}}),{previewUrl:null});
});
