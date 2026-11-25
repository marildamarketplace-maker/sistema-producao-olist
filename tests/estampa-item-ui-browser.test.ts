import test from "node:test";
import assert from "node:assert/strict";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("estampa permite seleção e código livre com lista flutuante",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/estampa-item-browser.tsx");
 for(const variante of [false,true]) for(const width of [390,1440]){
 const esperado=variante?"A":"6841";
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?w=${width}${variante?"&variante=1":""}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("input"))'),"Campo não abriu");
 await cdp.avaliar('document.querySelector("input").click()');
 await ate(()=>cdp.avaliar<boolean>(`[...document.querySelectorAll("button")].some(b=>b.textContent===${JSON.stringify(esperado)})`),"Código não carregou");
 assert.equal(await cdp.avaliar('getComputedStyle(document.querySelector(".absolute")).position'),"absolute");
 await cdp.avaliar(`[...document.querySelectorAll("button")].find(b=>b.textContent===${JSON.stringify(esperado)}).click()`);
 assert.equal(await cdp.avaliar('document.querySelector("output").textContent'),esperado);
 await cdp.avaliar('{const e=document.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"NOVA");e.dispatchEvent(new Event("input",{bubbles:true}));}');
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").focus()');
 assert.equal(await cdp.avaliar('document.querySelector("input").value'),"NOVA");
 assert.equal(await cdp.avaliar('document.querySelector("output").textContent'),"NOVA");
 }
});
