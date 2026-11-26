import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("logout local: interface real, erros e concorrência", { skip: chrome ? false : "Chrome/Chromium indisponível", timeout: 90_000 }, async t => {
  const logo = `data:image/png;base64,${(await readFile("public/brand/mts-transparent.png")).toString("base64")}`;
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/logout-browser.tsx", [{
    name: "dependencias-de-teste", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: path.resolve("tests/fixtures/logout-browser.tsx") }));
      builder.onResolve({ filter: /^next\/(navigation|link|image)$/ }, args => ({ path: args.path, namespace: "teste" }));
      builder.onLoad({ filter: /.*/, namespace: "teste" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? 'export default function Link(props) { return <a {...props} />; }'
        : args.path === "next/image" ? `export default function Image(props) { return <img {...props} src={${JSON.stringify(logo)}} />; }`
        : 'const router={replace(path){window.logoutTeste.redirects.push(path)}}; const params=new URLSearchParams(); export const useRouter=()=>router; export const usePathname=()=>"/estoque"; export const useSearchParams=()=>params;' }));
    },
  }]);
  const avaliar = <T,>(code: string) => cdp.avaliar<T>(code);
  const visivel = '[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Sair" && b.getClientRects().length)';
  const abrir = async (query = "") => {
    await cdp.pedir("Page.navigate", { url: `${url}?${query}` });
    await ate(() => avaliar<boolean>(`Boolean(window.logoutTeste && (${visivel}))`), "Botão Sair não carregou");
  };
  const clicar = () => avaliar(`${visivel}.click()`);
  const terminar = async (resultado: string) => {
    await avaliar(`window.logoutTeste.concluirSaida('${resultado}')`);
    await ate(() => avaliar<boolean>('![...document.querySelectorAll("button")].some(b => b.textContent.includes("Saindo"))'), "Saída não terminou");
  };
  const tecla = async (key: string, code = key) => {
    const virtualKey = key === "Enter" ? 13 : key === "Escape" ? 27 : 9;
    await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey, ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
  };
  await cdp.pedir("Page.navigate", { url });
  await ate(() => avaliar<boolean>('Boolean(window.logoutTeste?.estado.usuario)'), "Sessão inicial não carregou")
    .catch(async error => { throw new Error(`${error}: ${cdp.erros.join("; ")} ${await avaliar("document.body.innerText")}`); });

  for (const largura of [360, 390, 768, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`erro e nova tentativa em ${largura}px, ${tema}`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 800, deviceScaleFactor: 1, mobile: largura < 768 });
      // Primeiro renderiza o shell; no mobile o botão fica dentro do menu fechado.
      await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
      await ate(() => avaliar<boolean>('Boolean(window.logoutTeste?.estado.usuario)'), "Sessão não carregou");
      assert.equal(await avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      if (largura < 768) {
        await avaliar(`document.querySelector('button[aria-label="Abrir menu"]').focus()`);
        await tecla("Enter");
        await ate(() => avaliar<boolean>('Boolean(document.querySelector("[role=dialog]"))'), "Menu não abriu por teclado");
        assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Fechar menu");
        await tecla("Escape");
        await ate(() => avaliar<boolean>('!document.querySelector("[role=dialog]")'), "Escape não fechou o menu");
        assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Abrir menu");
        await tecla("Enter");
        await ate(() => avaliar<boolean>('Boolean(document.querySelector("[role=dialog]"))'), "Menu não reabriu");
      }
      const caixa = await avaliar<{ x: number; y: number; width: number; height: number }>(`JSON.parse(JSON.stringify(${visivel}.getBoundingClientRect()))`);
      assert.ok(caixa.height >= 44 && caixa.width >= 44);
      assert.ok(caixa.y >= 0 && caixa.y + caixa.height <= 800, "Saída deve estar acessível na tela");
      if (largura < 768) {
        await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 }] });
        await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await avaliar(`${visivel}.focus()`);
        await tecla("Enter");
      }
      await ate(() => avaliar<boolean>('window.logoutTeste.escopos.length === 1'), "Saída não iniciou");
      await avaliar('void window.logoutTeste.sair(); void window.logoutTeste.sair()');
      assert.deepEqual(await avaliar("window.logoutTeste.escopos"), ["local"], "Cliques repetidos não repetem a chamada");
      assert.equal(await avaliar('[...document.querySelectorAll("button")].filter(b => b.textContent.includes("Saindo")).every(b => b.disabled && b.getAttribute("aria-busy") === "true")'), true);
      await terminar("erro");
      assert.equal(await avaliar("window.logoutTeste.estado.session && window.logoutTeste.estado.usuario"), true);
      assert.deepEqual(await avaliar("window.logoutTeste.redirects"), []);
      assert.equal(await avaliar('document.body.textContent.includes("Detalhe privado")'), false);
      assert.equal(await avaliar('Boolean(document.querySelector("[role=alert]"))'), true);
      assert.equal(await avaliar("document.documentElement.scrollWidth <= innerWidth"), true);
      const captura = await cdp.pedir("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(tmpdir(), `logout-${largura}-${tema}.png`), Buffer.from(String(captura.data), "base64"));
      await clicar(); await terminar("sucesso");
      await ate(() => avaliar<boolean>('window.logoutTeste.redirects.includes("/login")'), "Sucesso não abriu o login");
      assert.equal(await avaliar("window.logoutTeste.estado.usuario || window.logoutTeste.estado.session"), false);
      assert.deepEqual(await avaliar("window.logoutTeste.escopos"), ["local", "local"]);
    });
  }

  await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await t.test("duas saídas no mesmo instante enviam uma única requisição", async () => {
    await abrir();
    await avaliar('void window.logoutTeste.sair(); void window.logoutTeste.sair()');
    assert.deepEqual(await avaliar("window.logoutTeste.escopos"), ["local"]);
    await terminar("sucesso");
  });
  await t.test("menu libera foco e rolagem ao passar do mobile para desktop", async () => {
    await abrir();
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await avaliar(`document.querySelector('button[aria-label="Abrir menu"]').click()`);
    await ate(() => avaliar<boolean>('document.body.style.overflow === "hidden"'), "Menu não bloqueou rolagem");
    await avaliar(`${visivel}.focus()`);
    await tecla("Tab");
    assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Fechar menu", "Tab deve permanecer dentro do menu");
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await ate(() => avaliar<boolean>('!document.querySelector("[role=dialog]") && document.body.style.overflow !== "hidden"'), "Menu invisível não pode reter foco ou rolagem");
  });
  await t.test("exceção de rede preserva sessão e permite repetir", async () => {
    await abrir(); await clicar(); await terminar("excecao");
    assert.equal(await avaliar("window.logoutTeste.estado.session && window.logoutTeste.estado.usuario"), true);
    assert.deepEqual(await avaliar("window.logoutTeste.redirects"), []);
    await clicar(); await terminar("sucesso");
  });
  for (const fallback of [false, true]) await t.test(`resposta atrasada ${fallback ? "do fallback" : "da API"} não restaura usuário`, async () => {
    await abrir();
    await avaliar('window.logoutTeste.atrasarUsuario(); void window.logoutTeste.atualizar()');
    if (fallback) {
      await avaliar('window.logoutTeste.atrasarFallback(); window.logoutTeste.liberarUsuario(500)');
      await ate(() => avaliar<boolean>("window.logoutTeste.fallbacks > 0"), "Fallback não iniciou");
    }
    await clicar();
    const consultas = await avaliar("window.logoutTeste.consultas");
    await avaliar('window.logoutTeste.emitir()');
    assert.equal(await avaliar("window.logoutTeste.consultas"), consultas, "Não carregar usuário enquanto sai");
    await terminar("sucesso");
    await avaliar(fallback ? 'window.logoutTeste.liberarFallback()' : 'window.logoutTeste.liberarUsuario()');
    // Barreira de renderização: permite que a resposta resolvida chegue ao React.
    await avaliar('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await avaliar("window.logoutTeste.estado.usuario || window.logoutTeste.estado.session"), false);
  });
  await t.test("getSession inicial atrasado não restaura sessão encerrada", async () => {
    await cdp.pedir("Page.navigate", { url: `${url}?atrasarSessao=1` });
    await ate(() => avaliar<boolean>("Boolean(window.logoutTeste)"), "Fixture não iniciou");
    await avaliar('window.logoutTeste.emitir()');
    await ate(() => avaliar<boolean>("window.logoutTeste.estado.usuario"), "Evento não carregou sessão");
    await clicar(); await terminar("sucesso");
    await avaliar('window.logoutTeste.liberarSessaoInicial()');
    await avaliar('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await avaliar("window.logoutTeste.estado.usuario || window.logoutTeste.estado.session"), false);
  });
  await t.test("fallback após remoção da permissão antiga mantém acesso e recebimento quando a API falha", async () => {
    for (const width of [390, 1440]) {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await cdp.pedir("Page.navigate", { url: `${url}?recebimentoFallback=1` });
      await ate(() => avaliar<boolean>("Boolean(window.logoutTeste?.estado.usuario)"), "Fallback não recuperou o usuário após a remoção da coluna");
      assert.ok(await avaliar<number>("window.logoutTeste.fallbacks") > 0);
      const projecoes = await avaliar<string[]>("window.logoutTeste.projecoesFallback");
      assert.ok(projecoes.every(p => !p.includes("pode_visualizar_olist_formas_pagamento")));
      assert.ok(projecoes.every(p => p.includes("pode_visualizar_olist_formas_recebimento")));
      assert.equal(await avaliar('Boolean(document.querySelector(\'a[href="/olist/formas-recebimento"]\'))'), true);
      assert.equal(await avaliar('document.body.textContent.includes("Acesso não autorizado")'), false);
    }
  });
  await t.test("botão da tela de acesso não autorizado também trata falhas", async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await abrir("semAcesso=1");
    assert.match(await avaliar<string>("document.body.textContent"), /Acesso não autorizado/);
    await clicar(); await terminar("erro");
    assert.deepEqual(await avaliar("window.logoutTeste.redirects"), []);
    assert.match(await avaliar<string>("document.body.textContent"), /Não foi possível sair/);
    await clicar(); await terminar("sucesso");
    assert.deepEqual(await avaliar("window.logoutTeste.escopos"), ["local", "local"]);
  });
});
