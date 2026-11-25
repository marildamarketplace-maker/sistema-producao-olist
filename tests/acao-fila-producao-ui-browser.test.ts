import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("ação de produção oculta ausência de fornecedor e explica vendedor bloqueado", { skip: chrome ? false : "Chrome indisponível", timeout: 60_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/acao-fila-producao-browser.tsx", [{ name: "link-local", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve("tests/fixtures/olist-empresa-link.tsx") }));
  } }]);
  for (const width of [360, 1440]) for (const tema of ["light", "dark"]) await t.test(`${width}px ${tema}`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("[data-testid=habilitada] a"))'), "Ação não carregou");
    assert.equal(await cdp.avaliar('document.querySelector("[data-testid=sem-fornecedor]").children.length'), 0);
    assert.equal(await cdp.avaliar('document.querySelector("[data-testid=sem-vendedor] button").disabled'), true);
    assert.equal(await cdp.avaliar('document.querySelector("[data-testid=sem-vendedor] a")===null'), true);
    assert.equal(await cdp.avaliar('document.querySelector("[data-testid=existente] button").textContent'), "PENDENTE");
    await cdp.pedir("Page.bringToFront");
    await cdp.avaliar('document.querySelector("[data-testid=sem-vendedor] [tabindex]").focus()');
    await ate(() => cdp.avaliar<boolean>('getComputedStyle(document.querySelector("[role=tooltip]")).display!=="none"'), "Motivo não aparece por teclado");
    await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert.equal(await cdp.avaliar('getComputedStyle(document.querySelector("[role=tooltip]")).display'), "none");
    await cdp.avaliar('document.querySelector("[tabindex]").blur()');
    const rect = await cdp.avaliar<{ x: number; y: number; width: number; height: number }>('JSON.parse(JSON.stringify(document.querySelector("[data-testid=sem-vendedor] [tabindex]").getBoundingClientRect()))');
    assert.ok(rect.height >= 44);
    await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] });
    await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ate(() => cdp.avaliar<boolean>('getComputedStyle(document.querySelector("[role=tooltip]")).display!=="none"'), "Motivo não aparece por toque");
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  });
  assert.deepEqual(cdp.erros, []);
});
