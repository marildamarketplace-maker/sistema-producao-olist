import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("configuração: layout desktop/mobile, teclado, prioridade e erro recuperável", { skip: chrome ? false : "Chrome indisponível", timeout: 90000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/direcionamento-configuracao-browser.tsx", [{
    name: "auth-configuracao-mock", setup(build) {
      build.onResolve({ filter: /components\/auth-provider$/ }, () => ({ path: "auth-mock", namespace: "direcionamento" }));
      build.onLoad({ filter: /.*/, namespace: "direcionamento" }, () => ({ contents: `import {useEffect,useState} from "react";
        export function useAuth(){
          const [auth,setAuth]=useState(()=>({...window.direcionamentoTeste.auth}));
          useEffect(()=>{const atualizar=()=>setAuth({...window.direcionamentoTeste.auth});window.addEventListener("auth-test",atualizar);return ()=>window.removeEventListener("auth-test",atualizar)},[]);
          return {session:{access_token:auth.token},usuario:{id:auth.usuario,aplicativo_id:auth.app,podeEditarConfiguracao:true}};
        }`, loader: "js", resolveDir: process.cwd() }));
    },
  }]);
  for (const largura of [360, 390, 1280, 1440]) for (const tema of ["light", "dark"]) {
    await t.test(`${largura}px ${tema}`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 850, deviceScaleFactor: 1, mobile: largura < 768 });
      await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
      await ate(() => cdp.avaliar<boolean>(`document.querySelectorAll('input[value="Regra 1"]').length === 1`), "Regras não carregaram");
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await cdp.avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      await cdp.avaliar(`document.querySelector('button[aria-label="Descer regra 1"]').focus()`);
      assert.equal(await cdp.avaliar('document.activeElement.getAttribute("aria-label")'), "Descer regra 1");
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]').value === "Regra 2"`), "Teclado não reordenou regras");
      await cdp.avaliar('window.direcionamentoTeste.erro=true; document.querySelector("button[type=submit]").click()');
      await ate(() => cdp.avaliar<boolean>('Boolean(document.querySelector("[role=alert]"))'), "Conflito não exibiu aviso");
      assert.equal(await cdp.avaliar(`document.querySelector('input[maxlength="100"]').value`), "Regra 2");
      await cdp.avaliar('window.direcionamentoTeste.erro=false; document.querySelector("button[type=submit]").click()');
      await ate(() => cdp.avaliar<boolean>('window.direcionamentoTeste.salvos.length === 1'), "Configuração não salvou após recuperação");
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
    });
  }
  await t.test("rascunho sobrevive à renovação do token; recarga explícita substitui", async () => {
    await cdp.pedir("Page.navigate", { url });
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "Regra 1"`), "Regras não carregaram");
    await cdp.avaliar(`document.querySelector('button[aria-label="Descer regra 1"]').click()`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]').value === "Regra 2"`), "Prioridade não mudou");
    await cdp.avaliar(`window.direcionamentoTeste.mudarAuth({token:"renovado"})`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "Regra 2"`), "Renovação apagou rascunho");
    assert.equal(await cdp.avaliar('window.direcionamentoTeste.leituras'), 1);
    await cdp.avaliar(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Recarregar configuração salva').click()`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "Regra 1" && window.direcionamentoTeste.leituras===2`), "Recarga explícita não substituiu rascunho");
  });
  await t.test("GET obsoleto não sobrescreve PUT concluído", async () => {
    await cdp.pedir("Page.navigate", { url: `${url}?segurarGet=1` });
    await ate(() => cdp.avaliar<boolean>('window.direcionamentoTeste?.leituras===1'), "GET inicial não começou");
    await cdp.avaliar(`window.direcionamentoTeste.segurarGet=false;window.direcionamentoTeste.mudarAuth({token:"novo"})`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "Regra 1"`), "GET com token novo não terminou");
    await cdp.avaliar(`document.querySelector('button[aria-label="Descer regra 1"]').click()`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]').value === "Regra 2"`), "Prioridade não mudou");
    await cdp.avaliar(`document.querySelector('button[type=submit]').click()`);
    await ate(() => cdp.avaliar<boolean>('window.direcionamentoTeste.salvos.length===1 && Boolean(document.querySelector("[role=status]"))'), "PUT não concluiu");
    await cdp.avaliar('window.direcionamentoTeste.liberarGets()');
    await cdp.avaliar('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await cdp.avaliar(`document.querySelector('input[maxlength="100"]').value`), "Regra 2");
    assert.match(await cdp.avaliar<string>('document.querySelector("[role=status]").textContent'), /Direcionamento salvo/);
  });
  await t.test("trocar usuário/app limpa rascunho e ignora PUT do contexto anterior", async () => {
    await cdp.pedir("Page.navigate", { url });
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "Regra 1"`), "Regras não carregaram");
    await cdp.avaliar(`window.direcionamentoTeste.segurarPut=true;document.querySelector('button[type=submit]').click()`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('button[type=submit]')?.textContent==='Salvando...'`), "PUT não começou");
    await cdp.avaliar(`window.direcionamentoTeste.mudarAuth({usuario:"usuario2",token:"outro-usuario"})`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "pai/usuario2"`), "Trocar usuário não limpou rascunho");
    await cdp.avaliar('window.direcionamentoTeste.liberarPuts()');
    await cdp.avaliar('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await cdp.avaliar(`document.querySelector('input[maxlength="100"]').value`), "pai/usuario2");
    assert.equal(await cdp.avaliar('Boolean(document.querySelector("[role=status]"))'), false);
    await cdp.avaliar(`document.querySelector('button[aria-label="Descer regra 1"]').click();window.direcionamentoTeste.mudarAuth({app:"outro-pai",token:"outro-app"})`);
    await ate(() => cdp.avaliar<boolean>(`document.querySelector('input[maxlength="100"]')?.value === "outro-pai/usuario2"`), "Trocar aplicativo não limpou rascunho");
  });
  assert.deepEqual(cdp.erros, []);
});
