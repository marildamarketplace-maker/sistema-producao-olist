import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("cliente compacto abre busca sobre o formulário sem deslocar conteúdo", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t,"tests/fixtures/pedido-manual-browser.tsx",[{name:"link-local",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:path.resolve("tests/fixtures/olist-empresa-link.tsx")}));}}]);
  for (const width of [390,1440]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await cdp.pedir("Page.navigate",{url:`${url}?width=${width}`});
    await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'),"Conta não carregou");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()');
    await ate(()=>cdp.avaliar<boolean>('[...document.querySelectorAll("label")].some(l=>l.textContent==="Cliente")'),"Cliente não abriu");
    await ate(()=>cdp.avaliar<boolean>('document.querySelector("button[aria-expanded]")?.textContent.includes("Cliente com nome")'),"Resultado único não foi selecionado");
    const altura=await cdp.avaliar<number>('document.querySelector("section").getBoundingClientRect().height');
    await cdp.avaliar('document.querySelector("button[aria-expanded]").click()');
    await ate(()=>cdp.avaliar<boolean>('Boolean(document.querySelector("input[autofocus]")) || Boolean(document.querySelector("input"))'),"Busca não abriu");
    assert.equal(await cdp.avaliar('getComputedStyle(document.querySelector("button[aria-expanded]").parentElement.querySelector("div.absolute")).position'),"absolute");
    assert.equal(await cdp.avaliar('document.querySelector("section").getBoundingClientRect().height'),altura);
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'),true);
    await cdp.avaliar('document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    assert.equal(await cdp.avaliar('document.querySelector("button[aria-expanded]").getAttribute("aria-expanded")'),"false");
  }
});
