import test from "node:test";
import assert from "node:assert/strict";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";
test("recuperação no envio preserva campos, pede apenas pendentes e retoma sem sobrescrever edição", { skip: !chrome }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/recuperacao-fila-browser.tsx");
  for (const width of [390, 1440]) for (const tema of ["light", "dark"]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?parcial=1&tema=${tema}&w=${width}` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página ausente");
    await cdp.avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Mais de uma correspondência")'), "Pendência ausente");
    await ate(() => cdp.avaliar<boolean>('window.recuperacaoTeste.chamadas.length===5 && !document.body.innerText.includes("Recuperando cadastros")'), "Recuperação incompleta");
    assert.equal(await cdp.avaliar('document.querySelectorAll("fieldset").length'), 0, "produto e vendedor recuperados não devem exigir novo preenchimento");
    assert.equal(await cdp.avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    if (process.env.OLIST_RECUPERACAO_SCREENSHOTS === "1") {
      const captura = await cdp.pedir("Page.captureScreenshot", { format: "png" });
      assert.equal(typeof captura.data, "string");
      await (await import("node:fs/promises")).writeFile(`/private/tmp/recuperacao-${width}-${tema}.png`, Buffer.from(String(captura.data), "base64"));
    }
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Selecione cliente").click()');
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Buscar").click()');
    await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Cliente escolhido")'), "Pesquisa ausente");
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Cliente escolhido").click()');
    await cdp.avaliar('window.recuperacaoTeste.token()');
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").click()');
    await ate(() => cdp.avaliar<boolean>('window.recuperacaoTeste.previas.length===1'), "Revisão ausente");
    const previa = await cdp.avaliar<{ versao: number; selecoes: { clienteId: number; vendedorId: number; tecidos: Array<{ id: number; preco: number }> } }>('window.recuperacaoTeste.previas[0]');
    assert.equal(previa.versao, 7); assert.equal(previa.selecoes.clienteId, 130); assert.equal(previa.selecoes.vendedorId, 120);
    assert.equal(previa.selecoes.tecidos[0].id, 150); assert.equal(previa.selecoes.tecidos[0].preco, 21.99);
    assert.equal(await cdp.avaliar('window.recuperacaoTeste.chamadas.length'), 5);
    await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Fechar e atualizar fila").click()');
    await cdp.avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("dialog[open]"))'), "Reabertura ausente");
    assert.equal(await cdp.avaliar('window.recuperacaoTeste.chamadas.length'), 5, "reabertura não repete consultas concluídas");
  }
  await cdp.pedir("Page.navigate", { url: `${url}?pausar=1` });
  await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("#abrir"))'), "Página ausente");
  await cdp.avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
  await ate(() => cdp.avaliar<boolean>('window.recuperacaoTeste.chamadas.length===2'), "Recuperação não iniciou");
  await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Fechar e atualizar fila").click(); window.recuperacaoTeste.liberar()');
  assert.equal(await cdp.avaliar('document.activeElement.id'), "abrir", "fechar restaura o foco");
  await cdp.avaliar('document.querySelector("#abrir").focus(); document.querySelector("#abrir").click()');
  await ate(() => cdp.avaliar<boolean>('window.recuperacaoTeste.chamadas.length===3'), "Não retomou pendência");
  await cdp.avaliar('window.recuperacaoTeste.liberar()');
  await ate(() => cdp.avaliar<boolean>('window.recuperacaoTeste.chamadas.length===6 && !document.body.innerText.includes("Recuperando cadastros")'), "Não concluiu a retomada");
  assert.equal(await cdp.avaliar('window.recuperacaoTeste.chamadas.filter(c=>c==="vendedorId").length'), 1);
  await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent==="Revisar pedido").focus()');
  await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await cdp.avaliar('document.querySelector("dialog").contains(document.activeElement)'), true);
  assert.deepEqual(cdp.erros, []);
});
