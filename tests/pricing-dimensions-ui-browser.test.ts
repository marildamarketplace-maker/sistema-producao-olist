import test from "node:test";
import assert from "node:assert/strict";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("medidas preenchem metragem e atualizam custos em desktop e mobile", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pricing-calculator-browser.tsx");
  for (const width of [390, 1440]) for (const tema of ["light", "dark"]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("button"))'), "Calculadora ausente");
    await cdp.avaliar('[...document.querySelectorAll("summary")].find(s => s.textContent.includes("Calcular metragem")).click()');
    assert.equal(await cdp.avaliar('document.body.innerText.includes("3 peças por fileira")'), true);
    await cdp.avaliar('document.querySelector("button").click()');
    await ate(() => cdp.avaliar<boolean>('document.querySelectorAll("input")[1].value === "0,12"'), "Metragem não foi aplicada");
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
    await cdp.avaliar(`(() => {
      const field = [...document.querySelectorAll("label")].find(l => l.textContent.includes("Largura útil")).querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "20");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("p[role=alert]"))'), "Erro de corte ausente");
    assert.equal(await cdp.avaliar('document.querySelector("button") === null'), true);
    assert.equal(await cdp.avaliar('document.querySelectorAll("input")[1].value'), "0,12");
  }
});
