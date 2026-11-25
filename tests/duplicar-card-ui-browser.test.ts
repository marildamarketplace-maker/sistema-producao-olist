import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";
test("duplicar card copia todas as variantes com identidades independentes",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx",[{name:"link-local",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")}));}}]);
 for(const width of [390,1440]) {
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
 await cdp.pedir("Page.navigate",{url:`${url}?solicitacaoId=00000000-0000-0000-0000-000000000050&w=${width}`});
 for(let n=0;n<3;n++) {await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Continuar indisponível");await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');}
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===2'),"Itens ausentes");
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Adicionar variante").click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===3'),"Variante ausente");
 await cdp.avaliar('document.querySelector(\'button[aria-label="Duplicar card 1"]\').click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===5'),"Card não duplicou variantes");
 assert.deepEqual(await cdp.avaliar('[...document.querySelectorAll("fieldset")].map(f=>f.querySelectorAll("[data-item-id]").length)'),[2,1,2]);
 assert.equal(await cdp.avaliar('new Set([...document.querySelectorAll("[data-item-id]")].map(e=>e.dataset.itemId)).size'),5);
 assert.equal(await cdp.avaliar('document.body.innerText.includes("Metragem ajustada manualmente")'),false);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 await cdp.avaliar('[...document.querySelectorAll("fieldset")].forEach(f=>[...f.querySelectorAll("button")].find(b=>b.textContent==="Tecido sublimado").click())');
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Adicionar variante").click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===6'),"Variante de tecido não adicionada");
 await cdp.avaliar('{for(const row of document.querySelectorAll("[data-item-id]")){for(const input of row.querySelectorAll("input")){const value=input.type==="number"?"10":"B";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}}}');
 await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');
 await ate(()=>cdp.avaliar<boolean>('document.querySelector("section h3")?.textContent==="Dados comerciais"'),"Variante de tecido corrido não passou pela validação");
 await cdp.avaliar('document.getElementById([...document.querySelectorAll("label")].find(l=>l.textContent==="Forma de pagamento").htmlFor).focus()');
 assert.equal(await cdp.avaliar('(()=>{const input=document.getElementById([...document.querySelectorAll("label")].find(l=>l.textContent==="Forma de pagamento").htmlFor);return input.tagName==="INPUT"&&input.parentElement.parentElement.querySelectorAll("input").length===1;})()'),true,"Busca deve ficar no próprio campo");

 }
});
