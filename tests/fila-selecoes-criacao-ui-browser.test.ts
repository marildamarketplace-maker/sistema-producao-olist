import test from "node:test";
import assert from "node:assert/strict";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("envio reaproveita todas as seleções da criação somente no mesmo destino",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/vendedor-fila-browser.tsx");
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?dadosCriacao=1&vinculado=1&w=${width}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'),"Página ausente");await cdp.avaliar('document.querySelector("#abrir").click()');
 await ate(()=>cdp.avaliar<boolean>('document.body.innerText.includes("Dados selecionados na criação do pedido")'),"Seleções não reaproveitadas");
 assert.equal(await cdp.avaliar('document.querySelectorAll("fieldset").length'),0);
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
 await ate(()=>cdp.avaliar<boolean>('window.testeVendedorFila.previas.length===1'),"Revisão não executada");
 const selecoes=await cdp.avaliar<{clienteId:number;vendedorId:number;formaId:number;planoId:string;tipoVenda:string;tecidos:Array<{id:number;preco:number}>}>('window.testeVendedorFila.previas[0].selecoes');
 assert.equal(selecoes.clienteId,100);assert.equal(selecoes.vendedorId,200);assert.equal(selecoes.formaId,400);assert.equal(selecoes.tipoVenda,"VENDA");assert.equal(selecoes.tecidos[0].id,5168);assert.equal(selecoes.tecidos[0].preco,18.99);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
 await cdp.pedir("Page.navigate",{url:`${url}?dadosCriacao=1&destinoAlterado=1&vinculado=1`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'),"Página ausente");await cdp.avaliar('document.querySelector("#abrir").click()');
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("fieldset"))'),"Destino diferente deve permitir novas seleções");
 assert.equal(await cdp.avaliar('document.body.innerText.includes("Dados selecionados na criação do pedido")'),false);
});
