import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

const campo = '[...document.querySelectorAll("fieldset")].find(f => f.querySelector("legend")?.textContent === "Vendedor")';
const selecao = `(${campo}).querySelector("select")`;
test("fila: sugestão editável, snapshot, renovação de sessão e layout responsivo", { skip: chrome ? false : "Chrome indisponível", timeout: 90000 }, async (t) => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/vendedor-fila-browser.tsx");
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  for (const largura of [360, 390, 1280, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`${largura}px, ${tema}`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 850, deviceScaleFactor: 1, mobile: largura < 768 });
      await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página não carregou");
      await avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
      await ate(() => avaliar<boolean>(`Boolean(${campo}) && ${selecao}?.value === "200"`), "Padrão não preencheu");
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      await avaliar(`${campo}.querySelector("button").click()`);
      await ate(() => avaliar<boolean>(`${selecao}.querySelector('option[value="300"]') !== null`), "Pesquisa não carregou");
      await avaliar(`${selecao}.value = "300"; ${selecao}.dispatchEvent(new Event("change", { bubbles: true })); window.testeVendedorFila.trocarToken()`);
      await ate(() => avaliar<boolean>('window.testeVendedorFila.leituras >= 2'), "Sessão não atualizou");
      assert.equal(await avaliar(`${selecao}.value`), "300", "renovação não sobrescreve escolha manual");
      await avaliar(`${selecao}.value = ""; ${selecao}.dispatchEvent(new Event("change", { bubbles: true })); window.testeVendedorFila.trocarToken()`);
      await ate(() => avaliar<boolean>('window.testeVendedorFila.leituras >= 3'), "Sessão não atualizou novamente");
      assert.equal(await avaliar(`${selecao}.value`), "", "limpar não reaplica padrão");
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ate(() => avaliar<boolean>('window.testeVendedorFila.fechado'), "Escape não fechou modal");
      assert.equal(await avaliar('document.activeElement.id'), "abrir");
    });
  }
  await cdp.pedir("Page.navigate", { url: `${url}?salvo=1` });
  await ate(() => avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página não carregou");
  await avaliar('document.querySelector("#abrir").click()');
  await ate(() => avaliar<boolean>(`Boolean(${campo}) && ${selecao}?.value === "300"`), "Snapshot não prevaleceu sobre padrão");
  assert.deepEqual(cdp.erros, []);
});
