import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("direcionamento se recupera automaticamente sem ação do usuário",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx",[{name:"next-local",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")}));b.onResolve({filter:/^next\/image$/},()=>({path:path.resolve("tests/fixtures/preview-image-browser.tsx")}));}}]);
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?falhaDirecionamento=1&w=${width}`});
 for(let n=0;n<2;n++){await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Conta não abriu");await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');}
 await ate(()=>cdp.avaliar<boolean>('document.querySelector("section h3")?.textContent==="Aplicativo"'),"Etapa ausente");
 await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Não recuperou direcionamento");
 assert.equal(await cdp.avaliar('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="resolver").length'),3);
 assert.equal(await cdp.avaliar('document.body.innerText.includes("Atualizar direcionamento")'),false);
 assert.equal(await cdp.avaliar('Boolean(document.querySelector("[role=alert]"))'),false);
 assert.equal(await cdp.avaliar('document.querySelector("section dl dd").textContent'),"Filial com nome muito longo para verificar responsividade");
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
});
