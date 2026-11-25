import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("usuários clientes: confirmação explícita, conflito e layout mobile/desktop", { skip: chrome ? false : "Chrome indisponível", timeout: 60_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/usuarios-clientes-browser.tsx");
  const avaliar = <T,>(code: string) => cdp.avaliar<T>(code);
  const botao = (texto: string) => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(texto)})`;
  async function ativar(texto: string, mobile: boolean) {
    const alvo=botao(texto);
    await avaliar(`${alvo}.scrollIntoView({block:'center'})`);
    if (mobile) {
      const caixa=await avaliar<{x:number;y:number;width:number;height:number}>(`JSON.parse(JSON.stringify(${alvo}.getBoundingClientRect()))`);
      assert.ok(caixa.width>=44&&caixa.height>=44);
      await cdp.pedir("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:caixa.x+caixa.width/2,y:caixa.y+caixa.height/2}]});
      await cdp.pedir("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
    } else {
      await avaliar(`${alvo}.focus()`);
      await cdp.pedir("Input.dispatchKeyEvent", {type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"});
      await cdp.pedir("Input.dispatchKeyEvent", {type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    }
  }
  for (const largura of [360, 1440]) for (const tema of ["light", "dark"]) {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
    await ate(() => avaliar<boolean>(`Boolean(${botao("Configurar vendedores")})`), "Lista externa não carregou");
    assert.equal(await avaliar('window.usuariosClientesTeste.consultas.length'), 1);
    await ativar("Configurar vendedores", largura<768);
    await ate(() => avaliar<boolean>('document.querySelectorAll("input[type=checkbox]").length===2'), "Detalhe não carregou");
    assert.equal(await avaliar('document.querySelectorAll("input[type=checkbox]")[0].checked'), true);
    assert.equal(await avaliar('document.querySelectorAll("input[type=checkbox]")[1].checked'), false, "revogado não vem confirmado");
    assert.equal(await avaliar('document.querySelectorAll("input[inputmode=numeric]")[1].disabled'), true);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    await avaliar('document.querySelectorAll("input[type=checkbox]")[1].click()');
    await avaliar(`(()=>{const campo=document.querySelectorAll('input[inputmode=numeric]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(campo,'333');campo.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await ativar("Salvar vínculos de vendedor", largura<768);
    await ate(() => avaliar<boolean>('document.querySelector("[role=alert]")?.textContent.includes("Vínculos alterados")'), "Conflito não apareceu");
    assert.equal(await avaliar('document.querySelectorAll("input[inputmode=numeric]")[1].value'), "333");
    assert.equal(await avaliar('document.activeElement===document.querySelector("[role=alert]")'), true);
    await avaliar('window.usuariosClientesTeste.conflito=false');
    await ativar("Salvar vínculos de vendedor", largura<768);
    await ate(() => avaliar<boolean>('document.querySelector("[role=status]")?.textContent.includes("Vínculos de vendedor atualizados")'), "Não confirmou os vínculos");
    assert.equal(await avaliar('window.usuariosClientesTeste.payloads.at(-1).vendedoresOlist[1].vendedorOlistId'), 333);
    assert.equal(await avaliar('document.querySelector("form").textContent.includes("Permissões")'), false);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  assert.deepEqual(cdp.erros, []);
});
