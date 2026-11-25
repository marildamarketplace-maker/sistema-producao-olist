import test from "node:test";
import assert from "node:assert/strict";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";
test("lista de tamanho permanece ancorada ao campo ao lado de coluna alta",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/tamanho-ancora-browser.tsx");
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
 await cdp.pedir("Page.navigate",{url:`${url}?width=${width}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("input"))'),"Campo ausente");
 await cdp.avaliar('document.querySelector("input").focus();document.querySelector("input").click()');
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("div.absolute button"))'),"Opções ausentes");
 const distancia=await cdp.avaliar<number>('document.querySelector("div.absolute").getBoundingClientRect().top-document.querySelector("input").getBoundingClientRect().bottom');
 assert.ok(distancia>=0&&distancia<=16,`Distância incorreta: ${distancia}px`);
 }
});
