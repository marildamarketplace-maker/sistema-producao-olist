import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";
test("criação bloqueia revisão sem plano e serviço laser e permite corrigir no campo", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pedido-manual-browser.tsx", [{ name: "next-local", setup(b) {
    for (const [nome, arquivo] of [["link", "olist-empresa-link"], ["image", "preview-image-browser"]]) b.onResolve({ filter: new RegExp(`^next/${nome}$`) }, () => ({ path: path.resolve(`tests/fixtures/${arquivo}.tsx`) }));
  } }]);
  for (const width of [390, 1440]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?solicitacaoId=00000000-0000-0000-0000-000000000050&tema=${width < 768 ? "dark" : "light"}` });
    const continuar = async () => { await ate(() => cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent==="Continuar"&&!b.disabled)'), "Não pode continuar"); await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").click()'); };
    await continuar(); await continuar(); await continuar();
    await ate(() => cdp.avaliar<boolean>('document.querySelectorAll("[data-item-id]").length===2'), "Itens ausentes");
    await cdp.avaliar('document.querySelector("[data-item-id] input[type=checkbox]").click()');
    await continuar();
    await ate(() => cdp.avaliar<boolean>('document.querySelector("[data-campo-comercial=planoId] select")?.options.length===2'), "Plano não carregou");
    await continuar();
    await ate(() => cdp.avaliar<boolean>('document.activeElement.getAttribute("aria-invalid")==="true"'), "Não focou plano pendente");
    assert.equal(await cdp.avaliar('document.querySelector("section h3").textContent'), "Dados comerciais");
    assert.ok(await cdp.avaliar<boolean>('document.body.innerText.includes("Selecione o serviço de corte a laser da conta destinatária.")'));
    await cdp.avaliar('{const s=document.querySelector("[data-campo-comercial=planoId] select");s.value="00000000-0000-0000-0000-000000000070";s.dispatchEvent(new Event("change",{bubbles:true}));}');
    await continuar();
    assert.equal(await cdp.avaliar('document.querySelector("section h3").textContent'), "Dados comerciais");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Selecione serviço de corte a laser").click()');
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Buscar").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Corte a laser A")'), "Serviços ausentes");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Corte a laser A").click()');
    assert.equal(await cdp.avaliar('document.querySelector(\'[data-campo-comercial="laser.preco"] input\').disabled'), true);
    assert.equal(await cdp.avaliar('document.querySelector(\'[data-campo-comercial="laser.preco"] input\').value'), "2");
    await continuar();
    await ate(() => cdp.avaliar<boolean>('document.querySelector("section h3").textContent==="Revisão"'), "Não avançou após corrigir");
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    assert.ok(await cdp.avaliar<boolean>('window.testeManual.consultas.some(q=>new URLSearchParams(q).get("recurso")==="servicos")'));
    assert.equal(await cdp.avaliar('window.testeManual.envios.length'), 0);
  }
  assert.deepEqual(cdp.erros, []);
});
