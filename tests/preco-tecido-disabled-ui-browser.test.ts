import test from "node:test";
import assert from "node:assert/strict";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("preço do tecido é desabilitado e seleção dispensa textos auxiliares",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pesquisa-tecido-olist-browser.tsx");
 for(const width of [390,1440]) for(const tema of ["light","dark"]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?w=${width}&tema=${tema}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector(\'button[aria-label="Selecionar tecido"]\'))'),"Seletor ausente");
 await cdp.avaliar('document.querySelector(\'button[aria-label="Selecionar tecido"]\').click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("section ul button").length===2'),"Resultados ausentes");
 await cdp.avaliar('[...document.querySelectorAll("section ul button")].find(b=>b.textContent.includes("5168")).click()');
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector(\'input[type="number"]\'))'),"Preço ausente");
 assert.equal(await cdp.avaliar('document.querySelector(\'input[type="number"]\').disabled'),true);
 assert.equal(await cdp.avaliar('document.querySelector(\'input[type="number"]\').value'),"18.99");
 assert.equal(await cdp.avaliar('document.body.innerText.includes("Produto selecionado na conta Olist.")||document.body.innerText.includes("Preço aplicado apenas a este pedido.")'),false);
 assert.equal(await cdp.avaliar('window.consultasTecidos.length'),0);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
});
