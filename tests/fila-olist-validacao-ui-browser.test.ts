import test from "node:test";
import assert from "node:assert/strict";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";
test("plano pendente abre o campo, mostra a correção e preserva as demais seleções", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/vendedor-fila-browser.tsx");
  for (const width of [390, 1440]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?dadosCriacao=1&semPlano=1&vinculado=1` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página ausente");
    await cdp.avaliar('document.querySelector("#abrir").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Dados selecionados na criação")'), "Resumo ausente");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
    await ate(() => cdp.avaliar<boolean>('document.activeElement.getAttribute("aria-invalid")==="true"'), "Não focou o campo inválido");
    assert.equal(await cdp.avaliar('document.activeElement.tagName'), "SELECT");
    assert.equal(await cdp.avaliar('document.activeElement.closest("[data-campo-comercial]").dataset.campoComercial'), "planoId");
    assert.ok(await cdp.avaliar<boolean>('document.body.innerText.includes("Selecione um plano de pagamento associado à forma escolhida.")'));
    assert.equal(await cdp.avaliar('window.testeVendedorFila.previas.length'), 0, "validação local evita chamada inválida");
    await ate(() => cdp.avaliar<boolean>('document.activeElement.querySelectorAll("option").length===2'), "Planos ausentes");
    await cdp.avaliar('document.activeElement.value="00000000-0000-0000-0000-000000000030"; document.activeElement.dispatchEvent(new Event("change",{bubbles:true}))');
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
    await ate(() => cdp.avaliar<boolean>('window.testeVendedorFila.previas.length===1'), "Revisão não executou após correção");
    const r = await cdp.avaliar<{ clienteId: number; vendedorId: number; formaId: number; tecidos: Array<{ preco: number }> }>('window.testeVendedorFila.previas[0].selecoes');
    assert.equal(r.clienteId, 100); assert.equal(r.vendedorId, 200); assert.equal(r.formaId, 400); assert.equal(r.tecidos[0].preco, 18.99);
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  assert.deepEqual(cdp.erros, []);
});
