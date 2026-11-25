import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("preview de variante abre modal, fecha por Escape e some em variante livre",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/preview-variante-browser.tsx",[{name:"image-local",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:path.resolve("tests/fixtures/preview-image-browser.tsx")}));}}]);
 for(const width of [390,1440]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?w=${width}`});
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("button"))'),"Miniatura ausente");
 await cdp.avaliar('document.querySelector("button").focus();document.querySelector("button").click()');
 await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("dialog")?.open)'),"Modal não abriu");
 assert.equal(await cdp.avaliar('document.activeElement?.textContent'),"Fechar");
 await cdp.pedir("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
 await cdp.pedir("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
 await ate(()=>cdp.avaliar<boolean>('!document.querySelector("dialog")'),"Modal não fechou");
 assert.equal(await cdp.avaliar('document.activeElement?.getAttribute("aria-label")'),"Ampliar estampa 6841, variante B");
 await cdp.avaliar('{const e=document.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"NOVA");e.dispatchEvent(new Event("input",{bubbles:true}));}');
 await ate(()=>cdp.avaliar<boolean>('!document.querySelector("button")'),"Miniatura anterior permaneceu");
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 }
});
