import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("erros de itens aparecem nos inputs e focam primeiro inválido",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx",[{name:"link-local",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:path.resolve("tests/fixtures/preview-image-browser.tsx")}));b.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")}));}}]);
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?solicitacaoId=00000000-0000-0000-0000-000000000050&w=${width}`});
 for(let n=0;n<3;n++){await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Conta não abriu").catch(async e=>{console.error(await cdp.avaliar("document.body.innerText"),cdp.erros);throw e;});await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');}
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===2'),"Itens não abriram");
 await cdp.avaliar('{const f=document.querySelector("fieldset");for(const label of [...f.querySelectorAll("label")].filter(l=>["Estampa","Variante","Tipo de produto"].includes(l.textContent))){const e=label.htmlFor?document.getElementById(label.htmlFor):label.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"");e.dispatchEvent(new Event("input",{bubbles:true}));}}');
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("input[aria-invalid=true]").length>=3'),"Erros não ligados aos campos");
 assert.equal(await cdp.avaliar('document.activeElement.getAttribute("aria-invalid")'),"true");
 assert.equal(await cdp.avaliar('document.querySelector("section h3").textContent'),"Itens");
 assert.equal(await cdp.avaliar('document.querySelector("input[aria-invalid=true]").getAttribute("aria-describedby")!==null'),true);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
});
