import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {writeFile} from "node:fs/promises";
import {abrirChromeLocal,ate,chrome} from "./helpers/chrome-local";
test("revisão reúne o produto e separa tipos dentro do card",{skip:!chrome},async t=>{
 const {cdp,url}=await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx",[{name:"next-local",setup(b){for(const [nome,arquivo] of [["link","olist-empresa-link"],["image","preview-image-browser"]])b.onResolve({filter:new RegExp(`^next/${nome}$`)},()=>({path:path.resolve(`tests/fixtures/${arquivo}.tsx`)}));}}]);
 for(const width of [360,390,1280,1440]) for(const tema of ["light","dark"]){
 await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});await cdp.pedir("Page.navigate",{url:`${url}?solicitacaoId=00000000-0000-0000-0000-000000000050&w=${width}&tema=${tema}`});
 const avancar=async()=>{await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Não pode continuar");await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');};
 await avancar();await avancar();await avancar();
 await ate(()=>cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===2'),"Itens ausentes");
 await cdp.avaliar('{for(const [n,f] of [...document.querySelectorAll("fieldset")].entries()){for(const [label,value] of [["Tecido","Oxford"],["Tipo de produto",n===0?"Lenço":"Pareô"]]){const input=[...f.querySelectorAll("label")].find(l=>l.textContent.startsWith(label)).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}}}');
 await avancar();await avancar();
 await ate(()=>cdp.avaliar<boolean>('document.querySelector("section h3")?.textContent==="Revisão"'),"Revisão ausente");
 assert.equal(await cdp.avaliar('[...document.querySelectorAll("p")].filter(p=>p.textContent==="Produto Olist: Pendente").length'),1);
 assert.equal(await cdp.avaliar('document.querySelectorAll(\'section[aria-label="Lenço"],section[aria-label="Pareô"]\').length'),2);
 assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
 assert.equal(await cdp.avaliar(`getComputedStyle(document.querySelector('section[aria-label="Lenço"] dl')).gridTemplateColumns.split(" ").length`),width>=1024?6:2);
 if((width===390||width===1440)&&tema==="dark"){await cdp.avaliar('document.querySelector("article").scrollIntoView({block:"start"})');const shot=await cdp.pedir("Page.captureScreenshot",{format:"png"});await writeFile(`/private/tmp/revisao-layout-${width}.png`,Buffer.from(String(shot.data),"base64"));}

 }
});
