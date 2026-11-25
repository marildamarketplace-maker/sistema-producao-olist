import test from "node:test";
import assert from "node:assert/strict";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("detalhes de pessoas carregam sob demanda e reabrem sem consultar",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pessoas-destino-fila-browser.tsx");
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?w=${width}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("summary"))'),"Detalhes ausentes");
 assert.equal(await cdp.avaliar('window.consultasPessoas'),0);
 await cdp.avaliar('document.querySelector("summary").click()');
 await ate(()=>cdp.avaliar<boolean>('document.body.innerText.includes("Cliente no destino")'),"Pessoas não carregaram");
 assert.equal(await cdp.avaliar('document.body.innerText.includes("Vendedor no destino")&&document.body.innerText.includes("Conta de destino")'),true);
 await cdp.avaliar('document.querySelector("summary").click()');await cdp.avaliar('document.querySelector("summary").click()');
 assert.equal(await cdp.avaliar('window.consultasPessoas'),1);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
});
