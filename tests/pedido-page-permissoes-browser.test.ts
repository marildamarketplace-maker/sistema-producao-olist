import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("página única: permissão depende da origem e nunca usa OR entre fluxos", { skip: chrome ? false : "Chrome indisponível", timeout: 30_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pedido-page-browser.tsx", [{ name: "page-context", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.resolve("tests/fixtures/pedido-page-navigation.tsx") }));
    builder.onResolve({ filter: /^@\/components\/auth-provider$/ }, () => ({ path: path.resolve("tests/fixtures/pedido-page-auth.tsx") }));
    builder.onResolve({ filter: /^@\/components\/criar-pedido-manual$/ }, () => ({ path: path.resolve("tests/fixtures/pedido-page-form.tsx") }));
  } }]);
  for (const [query, permitido] of [["manual=1", true], ["producao=1", false], ["solicitacaoId=origem&manual=1", false], ["solicitacaoId=origem&producao=1", true], ["solicitacaoId=&manual=1", false], ["solicitacaoId=&producao=1", true], ["", false]] as const) {
    await cdp.pedir("Page.navigate", { url: `${url}?${query}` });
    await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("[data-testid=formulario]")) || document.body.innerText.includes("Acesso não autorizado")'), "Permissão não resolvida");
    assert.equal(await cdp.avaliar('Boolean(document.querySelector("[data-testid=formulario]"))'), permitido, query);
    if (permitido && query.includes("solicitacaoId=")) assert.equal(await cdp.avaliar('document.querySelector("[data-testid=formulario]").textContent'), query.includes("origem") ? "Produção: origem" : "Produção: invalida");
  }
  await cdp.pedir("Page.navigate", { url: `${url}?manual=1` });
  await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Pedido manual")'), "Manual indisponível");
  await cdp.avaliar('history.pushState(null,"","?manual=1&solicitacaoId=outra");dispatchEvent(new PopStateEvent("popstate"));');
  await ate(() => cdp.avaliar<boolean>('document.body.innerText.includes("Acesso não autorizado")'), "A troca da query reutilizou o contexto manual");
  assert.equal(await cdp.avaliar('Boolean(document.querySelector("[data-testid=formulario]"))'), false);
  assert.deepEqual(cdp.erros, []);
});
