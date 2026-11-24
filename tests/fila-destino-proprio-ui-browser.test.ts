import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("fila: fornecedor sem filhos seleciona sua própria conta e abre revisão Olist", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/fila-destino-proprio-browser.tsx");
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  const botao = (texto: string) => `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(texto)})`;
  for (const largura of [360, 390, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`${largura}px, ${tema}`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 768 });
      await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("select[id^=filial-]"))'), "Fila não carregou o seletor de destino");
      assert.equal(await avaliar('document.querySelector("select[id^=filial-]").value'), "", "a conta própria precisa de escolha explícita");
      assert.equal(await avaliar('document.querySelector("select[id^=filial-]").options.length'), 2, "fornecedor independente tem apenas a conta própria além do placeholder");
      assert.equal(await avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      await avaliar('const destino=document.querySelector("select[id^=filial-]"); destino.value="00000000-0000-0000-0000-000000000002"; destino.dispatchEvent(new Event("change",{bubbles:true}))');
      await ate(() => avaliar<boolean>(`!${botao("Salvar aplicativo")}.disabled`), "Salvar destino não habilitou");
      const caixa = await avaliar<{ x: number; y: number; width: number; height: number }>(`${botao("Salvar aplicativo")}.scrollIntoView({block:"center"}); JSON.parse(JSON.stringify(${botao("Salvar aplicativo")}.getBoundingClientRect()))`);
      assert.ok(caixa.width >= 44 && caixa.height >= 44);
      if (largura < 768) {
        await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 }] });
        await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await avaliar(`${botao("Salvar aplicativo")}.focus()`);
        await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      }
      await ate(() => avaliar<boolean>('window.testeDestinoProprio.chamadas.length === 1 && document.body.innerText.includes("Aplicativo destinatário atual")'), "Conta própria não foi salva");
      assert.deepEqual(await avaliar('window.testeDestinoProprio.chamadas.map(({filialId,enviarOlist})=>({filialId,enviarOlist}))'), [{ filialId: "00000000-0000-0000-0000-000000000002", enviarOlist: false }]);
      await avaliar(`${botao("Mais opções")}.click()`);
      await ate(() => avaliar<boolean>(`Boolean(${botao("Enviar para a Olist")})`), "Menu não abriu");
      await avaliar(`${botao("Enviar para a Olist")}.click()`);
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("dialog")) && window.testeDestinoProprio.leiturasEnvio === 1'), "Revisão da conta própria não abriu");
      await ate(() => avaliar<boolean>('[...document.querySelectorAll("fieldset")].some(f => f.querySelector("legend")?.textContent === "Vendedor" && f.querySelector("select")?.value === "700")'), "Vendedor da conta própria não preencheu");
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ate(() => avaliar<boolean>('!document.querySelector("dialog")'), "Escape não fechou a revisão");
    });
  }
  assert.deepEqual(cdp.erros, []);
});
