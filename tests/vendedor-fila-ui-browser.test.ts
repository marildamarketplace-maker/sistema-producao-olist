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

test("fila: voltar ao vínculo restaura o vendedor e renovar a sessão preserva a escolha manual", { skip: chrome ? false : "Chrome indisponível", timeout: 90000 }, async (t) => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/vendedor-fila-browser.tsx");
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  const cliente = '[...document.querySelectorAll("fieldset")].find(f => f.querySelector("legend")?.textContent === "Cliente")';
  const escolhaManual = 'document.querySelector("dialog input[type=checkbox]")';
  async function selecionar(campoPesquisa: string, valor: number) {
    await avaliar(`${campoPesquisa}.querySelector("button").click()`);
    await ate(() => avaliar<boolean>(`${campoPesquisa}?.querySelector('option[value="${valor}"]') !== null`), "Pesquisa não carregou");
    await avaliar(`{ const s = ${campoPesquisa}.querySelector("select"); s.value = "${valor}"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  }
  async function alternarEscolhaManual(mobile: boolean) {
    await avaliar(`${escolhaManual}.scrollIntoView({ block: "center" }); ${escolhaManual}.focus()`);
    if (mobile) {
      const ponto = await avaliar<{ x: number; y: number }>(`(() => { const r = ${escolhaManual}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [ponto] });
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    }
  }
  for (const largura of [360, 390, 1280, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`${largura}px, ${tema}`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 850, deviceScaleFactor: 1, mobile: largura < 768 });
      await cdp.pedir("Page.navigate", { url: `${url}?vinculado=1&tema=${tema}` });
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página não carregou");
      await avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
      await ate(() => avaliar<boolean>('document.body.textContent.includes("Vendedor do autor (fixo): 200")'), "Vendedor vinculado não carregou");
      assert.equal(await avaliar(`${cliente}.querySelector("select").value`), "100");
      await alternarEscolhaManual(largura < 768);
      await ate(() => avaliar<boolean>(`Boolean(${campo})`), "Escolha manual não abriu o seletor");
      await selecionar(campo, 300);
      assert.equal(await avaliar(`${cliente}.querySelector("select").value`), "", "trocar vendedor invalida o cliente");
      await selecionar(cliente, 101);
      await alternarEscolhaManual(largura < 768);
      await ate(() => avaliar<boolean>('document.body.textContent.includes("Vendedor do autor (fixo): 200")'), "Voltar ao vínculo não restaurou o vendedor original");
      assert.equal(await avaliar(`${cliente}.querySelector("select").value`), "", "voltar ao vínculo invalida o cliente da escolha manual");
      await avaliar('[...document.querySelectorAll("dialog button")].find(b => b.textContent === "Revisar pedido").click()');
      await ate(() => avaliar<boolean>('window.testeVendedorFila.previas.length === 1'), "Prévia não recebeu a seleção restaurada");
      await ate(() => avaliar<boolean>('document.querySelector("dialog [role=alert]")?.textContent.includes("Prévia interceptada") === true && [...document.querySelectorAll("dialog button")].some(b => b.textContent === "Revisar pedido" && !b.disabled)'), "Resposta da prévia não terminou");
      await avaliar('new Promise(resolve => requestAnimationFrame(resolve))');
      const previa = await avaliar<{ vendedorFonte: string; selecoes: { vendedorId: number; clienteId: number } }>('window.testeVendedorFila.previas[0]');
      assert.equal(previa.vendedorFonte, "VINCULO");
      assert.equal(previa.selecoes.vendedorId, 200);
      assert.equal(previa.selecoes.clienteId, 0);
      await alternarEscolhaManual(largura < 768);
      await ate(() => avaliar<boolean>(`Boolean(${campo})`), "Escolha manual não reabriu o seletor");
      await selecionar(campo, 300);
      await selecionar(cliente, 101);
      await avaliar('window.testeVendedorFila.trocarToken()');
      await ate(() => avaliar<boolean>('window.testeVendedorFila.leituras >= 2'), "Sessão não renovou");
      await avaliar('new Promise(resolve => requestAnimationFrame(resolve))');
      assert.equal(await avaliar(`${escolhaManual}.checked`), true);
      assert.equal(await avaliar(`Boolean(${campo}) && ${selecao}.value === "300"`), true, "renovar token mantém vendedor manual editável");
      assert.equal(await avaliar(`${cliente}.querySelector("select").value`), "101", "renovar token preserva cliente manual");
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ate(() => avaliar<boolean>('window.testeVendedorFila.fechado'), "Escape não fechou modal");
      assert.equal(await avaliar('document.activeElement.id'), "abrir");
    });
  }
  assert.deepEqual(cdp.erros, []);
});
