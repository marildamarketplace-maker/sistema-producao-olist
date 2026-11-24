import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("seis telas Olist: seletor no título, troca de empresa e empresa única", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/olist-empresa-browser.tsx", [{ name: "auth-local", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve("tests/fixtures/olist-empresa-link.tsx") }));
    builder.onResolve({ filter: /^@\/components\/(auth-provider|access-guard)$/ }, () => ({ path: path.resolve("tests/fixtures/olist-empresa-browser.tsx") }));
  } }]);
  for (const tela of ["produtos", "contatos", "pedidos", "formas-pagamento", "formas-recebimento", "vendedores"]) {
    for (const width of [360, 1440]) for (const tema of ["light", "dark"]) {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      const query = `?tela=${tela}&tema=${tema}`;
      await cdp.pedir("Page.navigate", { url: `${url}${query}` });
      await ate(() => cdp.avaliar<boolean>(`location.search===${JSON.stringify(query)} && Boolean(document.querySelector("header select"))`), "Seletor ausente").catch(async error => { console.error(await cdp.avaliar("document.body.innerText"), cdp.erros); throw error; });
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await cdp.avaliar('document.querySelector("header select").disabled'), false);
      assert.ok(await cdp.avaliar<number>('document.querySelector("header select").getBoundingClientRect().height') >= 44);
      await cdp.avaliar('const select=document.querySelector("header select"); select.focus(); select.value="filial"; select.dispatchEvent(new Event("change", {bubbles:true}));');
      await ate(() => cdp.avaliar<boolean>(`window.empresaTeste.consultas.some(u=>u.startsWith('/api/olist/${tela}?') && u.includes('aplicativoId=filial') && u.includes('offset=0'))`), "Consulta não seguiu a empresa");
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
    }
  }
  await cdp.pedir("Page.navigate", { url: `${url}?tela=produtos&renovacao=1` });
  await ate(() => cdp.avaliar<boolean>('location.search.includes("renovacao") && Boolean(document.querySelector("header select"))'), "Tela não carregou");
  await cdp.avaliar('const select=document.querySelector("header select"); select.value="filial"; select.dispatchEvent(new Event("change",{bubbles:true}));');
  await ate(() => cdp.avaliar<boolean>('document.querySelector("header select")?.value === "filial"'), "Filial não selecionada");
  await cdp.avaliar('const input=document.querySelector("form input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Filtro preservado"); input.dispatchEvent(new Event("input",{bubbles:true})); window.empresaTeste.renovar();');
  await ate(() => cdp.avaliar<boolean>('window.empresaTeste.consultas.filter(u=>u==="/api/olist/empresas").length===2'), "Renovação não revalidou empresas");
  assert.equal(await cdp.avaliar('document.querySelector("header select").value'), "filial");
  assert.equal(await cdp.avaliar('document.querySelector("form input").value'), "Filtro preservado");
  await cdp.avaliar('window.empresaTeste.trocarUsuario()');
  await ate(() => cdp.avaliar<boolean>('document.querySelector("header select")?.value === "matriz" && document.querySelector("form input")?.value === ""'), "Troca de identidade não limpou estado");

  await cdp.pedir("Page.navigate", { url: `${url}?tela=pedidos&exportacao=1` });
  await ate(() => cdp.avaliar<boolean>('location.search.includes("exportacao") && Boolean(document.querySelector("input[type=checkbox]"))'), "Pedidos não carregaram");
  await cdp.avaliar(`document.querySelector('input[aria-label="Selecionar pedido 1"]').click(); document.querySelector('input[aria-label="Selecionar pedido 2"]').click()`);
  await ate(() => cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Exportar Pedidos") && !b.disabled)'), "Seleção não habilitou exportação");
  await cdp.avaliar('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Exportar Pedidos")).click()');
  await ate(() => cdp.avaliar<boolean>('window.empresaTeste.pendentes.length === 1'), "Exportação não iniciou");
  await cdp.avaliar('const select=document.querySelector("header select"); select.value="filial"; select.dispatchEvent(new Event("change",{bubbles:true}));');
  await ate(() => cdp.avaliar<boolean>('window.empresaTeste.cancelamentos === 1'), "Exportação não foi cancelada");
  await cdp.avaliar('window.empresaTeste.pendentes[0]()');
  await cdp.avaliar('new Promise(resolve=>setTimeout(resolve,50))');
  assert.equal(await cdp.avaliar('window.empresaTeste.downloads'), 0);
  assert.equal(await cdp.avaliar('window.empresaTeste.consultas.filter(u=>/^\\/api\\/olist\\/pedidos\\/\\d+/.test(u)).length'), 1);
  await cdp.pedir("Page.navigate", { url: `${url}?unica=1` });
  await ate(() => cdp.avaliar<boolean>('document.querySelector("header select")?.disabled === true'), "Empresa única não foi desabilitada");
  assert.deepEqual(cdp.erros, []);
});
