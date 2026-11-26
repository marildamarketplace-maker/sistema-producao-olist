import test from "node:test";
import assert from "node:assert/strict";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("429 preserva seleções, bloqueia durante espera e atualiza versão sem repetir envio", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/vendedor-fila-browser.tsx");
  for (const width of [390, 1440]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?dadosCriacao=1&vinculado=1&limite=1&tema=${width < 768 ? "dark" : "light"}` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página ausente");
    await cdp.avaliar('document.querySelector("#abrir").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Dados selecionados na criação")'), "Resumo ausente");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("A tentativa foi interrompida pelo limite")'), "Espera não informada");
    assert.equal(await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").disabled'), true);
    assert.equal(await cdp.avaliar('window.testeVendedorFila.previas.length'), 1);
    assert.equal(await cdp.avaliar('document.body.innerText.includes("Corrija os campos indicados")'), false);
    // Avança somente o relógio local: não há temporizador de reenvio nem polling.
    await cdp.avaliar('Date.now = () => new Date().getTime() + 120_000');
    await ate(() => cdp.avaliar<boolean>('![...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").disabled'), "Espera não expirou");
    assert.equal(await cdp.avaliar('window.testeVendedorFila.previas.length'), 1);
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
    await ate(() => cdp.avaliar<boolean>('window.testeVendedorFila.previas.length===2'), "Nova revisão ausente");
    assert.equal(await cdp.avaliar('window.testeVendedorFila.previas[1].versao'), 2);
    assert.equal(await cdp.avaliar('window.testeVendedorFila.previas[1].selecoes.formaId'), 400);
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  assert.deepEqual(cdp.erros, []);
});
