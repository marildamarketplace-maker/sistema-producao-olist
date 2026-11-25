import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("editor de itens: pesquisa sob demanda, associação estável, remoção e limite em desktop/mobile", { skip: chrome ? false : "Chrome indisponível", timeout: 60_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/itens-pedido-editor-browser.tsx");
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  for (const width of [360, 1440]) for (const tema of ["light", "dark"]) await t.test(`${width}px ${tema}`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
    await ate(() => avaliar<boolean>('document.querySelectorAll("fieldset").length===2'), "Editor não abriu");
    assert.equal(await avaliar("window.consultasEditor.length"), 0, "Abertura não pesquisa automaticamente todos os itens");
    assert.equal(await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Adicionar item").disabled'), true);
    await avaliar('[...document.querySelectorAll("button")].filter(b=>b.getAttribute("aria-label")==="Procurar nome do tecido na Olist")[1].click()');
    await ate(() => avaliar<boolean>('JSON.parse(document.querySelector("#selecoes").textContent)[1].id===123'), "Pesquisa não associou à segunda linha");
    await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Remover item 1").click()');
    assert.equal(await avaliar('JSON.parse(document.querySelector("#selecoes").textContent)[0].id'), 123, "Remover a primeira linha preserva o produto associado à segunda");
    assert.equal(await avaliar('document.querySelector("fieldset input").value'), "Cetim");
    assert.equal(await avaliar('[...document.querySelectorAll("fieldset input")].find(e=>e.step==="0.01").value'), "10");
    await avaliar('{const e=document.querySelector("fieldset input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Outro tecido");e.dispatchEvent(new Event("input",{bubbles:true}));}');
    assert.equal(await avaliar('JSON.parse(document.querySelector("#selecoes").textContent)[0].id'), 0, "Alterar tecido invalida o produto anterior");
    await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Adicionar item").click()');
    assert.equal(await avaliar('document.querySelectorAll("fieldset").length'), 2);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    assert.equal(await avaliar('[...document.querySelectorAll("button")].every(b=>b.getBoundingClientRect().height>=44)'), true);
    await avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Remover item 2").click();[...document.querySelectorAll("button")].find(b=>b.textContent==="Remover item 1").click()');
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Nenhum item")'), "Estado vazio não apareceu");
  });
  assert.deepEqual(cdp.erros, []);
});
