import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("usuários: edição por conta com carga sob demanda, conflitos, modal e isolamento de cache", { skip: chrome ? false : "Chrome/Chromium indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/usuarios-browser.tsx", [{
    name: "dependencias-usuarios", setup(builder) {
      builder.onResolve({ filter: /^(@\/components\/(auth-provider|access-guard)|next\/navigation)$/ }, () => ({ path: path.resolve("tests/fixtures/usuarios-browser.tsx") }));
    },
  }]);
  const avaliar = <T,>(code: string) => cdp.avaliar<T>(code);
  const botao = (texto: string) => `[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(texto)})`;
  const ativar = async (texto: string, mobile: boolean) => {
    const alvo = botao(texto);
    await avaliar(`${alvo}.scrollIntoView({block:"center"})`);
    if (mobile) {
      const caixa = await avaliar<{ x: number; y: number; width: number; height: number }>(`JSON.parse(JSON.stringify(${alvo}.getBoundingClientRect()))`);
      assert.ok(caixa.width >= 44 && caixa.height >= 44);
      const ponto = { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [ponto] });
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await avaliar(`${alvo}.focus()`);
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
  };
  for (const largura of [360, 390, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`${largura}px ${tema}: carregamento lazy, edição e recuperação de conflito`, async () => {
      const mobile = largura < 768;
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile });
      await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("article"))'), "Lista não carregou");
      assert.equal(await avaliar('window.usuariosTeste.consultas.length'), 1);
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      await avaliar('document.querySelector("article button").click()');
      await ate(() => avaliar<boolean>(`Boolean(${botao("Editar usuário")})`), "Detalhe não carregou");
      assert.equal(await avaliar('window.usuariosTeste.consultas.filter(c=>c.url.includes("usuarioId=")).length'), 1);
      assert.equal(await avaliar('window.usuariosTeste.consultas.some(c=>c.url.includes("recurso=aplicativos"))'), false);
      await ativar("Editar usuário", mobile);
      await ate(() => avaliar<boolean>('document.querySelectorAll("form input[inputmode=numeric]").length===2'), "Editor de vínculos não abriu");
      assert.equal(await avaliar('window.usuariosTeste.consultas.filter(c=>c.url.includes("recurso=aplicativos")).length'), 1);
      await avaliar('const campo=document.querySelectorAll("form input[inputmode=numeric]")[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(campo,"777"); campo.dispatchEvent(new Event("input",{bubbles:true}));');
      await ativar("Salvar usuário", mobile);
      await ate(() => avaliar<boolean>('document.querySelector("[role=alert]")?.textContent.includes("vínculos foram alterados")'), "Conflito não foi apresentado");
      assert.equal(await avaliar('document.querySelectorAll("form input[inputmode=numeric]")[1].value'), "777");
      await avaliar('window.usuariosTeste.renovarToken()');
      await ate(() => avaliar<boolean>('Boolean(document.querySelectorAll("form input[inputmode=numeric]")[1])'), "Refresh descartou edição");
      assert.equal(await avaliar('document.querySelectorAll("form input[inputmode=numeric]")[1].value'), "777");
      await avaliar('window.usuariosTeste.falharSalvar=false');
      await ativar("Salvar usuário", mobile);
      await ate(() => avaliar<boolean>('document.querySelector("[role=status]")?.textContent.includes("Usuário atualizado")'), "Salvamento não concluiu");
      const perfil = await avaliar<{ vendedoresOlist: Array<{ aplicativoId: string; vendedorOlistId: number }>; vinculosOlistVersao: number; vendedorOlistId?: unknown }>('window.usuariosTeste.salvos.at(-1).profile');
      assert.equal(perfil.vendedoresOlist[1].vendedorOlistId, 777); assert.equal(perfil.vinculosOlistVersao, 3); assert.equal(perfil.vendedorOlistId, undefined);
      await ativar("Criar usuário", mobile);
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("dialog[open]"))'), "Modal não abriu");
      assert.equal(await avaliar('document.activeElement===document.querySelector("dialog input")'), true);
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ate(() => avaliar<boolean>('!document.querySelector("dialog")'), "Escape não fechou modal");
      assert.equal(await avaliar(`document.activeElement===${botao("Criar usuário")}`), true);
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
    });
  }
  await t.test("resposta pendente da conta anterior não preenche detalhes nem opções na nova conta", async () => {
    await cdp.pedir("Page.navigate", { url });
    await ate(() => avaliar<boolean>('Boolean(document.querySelector("article"))'), "Lista não carregou");
    await avaliar('document.querySelector("article button").click()');
    await ate(() => avaliar<boolean>(`Boolean(${botao("Editar usuário")})`), "Detalhe não carregou");
    await avaliar('window.usuariosTeste.deferir=true');
    await avaliar(`${botao("Editar usuário")}.click()`);
    await ate(() => avaliar<boolean>('window.usuariosTeste.pendentes.length===2'), "Consultas não ficaram pendentes");
    await avaliar('window.usuariosTeste.deferir=false; window.usuariosTeste.trocarEscopo()');
    await ate(() => avaliar<boolean>('document.querySelector("article")?.textContent.includes("conta B")'), "Troca de conta não carregou nova lista");
    await avaliar('window.usuariosTeste.pendentes.forEach(p=>p.concluir())');
    assert.equal(await avaliar('Boolean(document.querySelector("form"))'), false);
    await ativar("Criar usuário", false);
    await ate(() => avaliar<boolean>('window.usuariosTeste.consultas.some(c=>c.aplicativoId.endsWith("0004")&&c.url.includes("recurso=aplicativos"))'), "Opções não foram recarregadas para conta B");
    await ativar("Adicionar vendedor", false);
    await ate(() => avaliar<boolean>('Boolean(document.querySelector("dialog select"))'), "Vínculo não foi adicionado");
    assert.equal(await avaliar('document.querySelector("dialog select").textContent.includes("Conta B")'), true);
    assert.equal(await avaliar('document.querySelector("dialog select").textContent.includes("Matriz do usuário")'), false);
  });
  assert.deepEqual(cdp.erros, []);
});
