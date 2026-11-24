import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("fornecedores: cadastro sem vendedor/comerciais, escopo de aplicativo e recuperação de falha", { skip: chrome ? false : "Chrome/Chromium indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/fornecedores-browser.tsx", [{
    name: "dependencias-fornecedores", setup(builder) {
      builder.onResolve({ filter: /^@\/(components\/(auth-provider|access-guard)|lib\/supabase)$/ }, () => ({ path: path.resolve("tests/fixtures/fornecedores-browser.tsx") }));
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
    await t.test(`${largura}px, tema ${tema}: editar, corrigir erro e salvar`, async () => {
      const mobile = largura < 768;
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile });
      const query = `?tema=${tema}&largura=${largura}`;
      await cdp.pedir("Page.navigate", { url: `${url}${query}` });
      await ate(() => avaliar<boolean>(`location.search===${JSON.stringify(query)} && Boolean(${botao("Editar")}) && window.fornecedoresTeste.salvos.length===0`), "Lista de fornecedores não carregou");
      assert.equal(await avaliar('document.documentElement.classList.contains("dark")'), tema === "dark");
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await avaliar('/Usuário vendedor|Meu ID de cliente|forma de pagamento Olist|Meu plano/.test(document.body.textContent)'), false);
      await ativar("Editar", mobile);
      await ate(() => avaliar<boolean>('Boolean(document.querySelector("form input"))'), "Formulário não abriu");
      assert.equal(await avaliar('document.querySelectorAll("form input,form select,form textarea").length'), 3);
      await avaliar('const campo=document.querySelector("form input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(campo,"Fornecedor atualizado"); campo.dispatchEvent(new Event("input",{bubbles:true}));');
      await ativar("Salvar edicao", mobile);
      await ate(() => avaliar<boolean>('document.querySelector("[role=alert]")?.textContent.includes("Falha recuperável")'), "Erro não foi apresentado");
      assert.equal(await avaliar('document.querySelector("form input").value'), "Fornecedor atualizado");
      await avaliar('window.fornecedoresTeste.falharSalvar=false');
      await ativar("Salvar edicao", mobile);
      await ate(() => avaliar<boolean>('document.querySelector("[role=status]")?.textContent.includes("atualizado com sucesso")'), "Salvamento não concluiu");
      const payload = await avaliar<Record<string, unknown>>('window.fornecedoresTeste.salvos.at(-1)');
      assert.deepEqual(Object.keys(payload).sort(), ["aplicativo_pai_id", "endereco", "id", "nome"]);
      assert.equal(payload.nome, "Fornecedor atualizado");
      assert.equal(await avaliar('window.fornecedoresTeste.projecoes.every(p=>!p.includes("vendedor")&&!p.includes("meu_"))'), true);
      assert.equal(await avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
    });
  }
  assert.deepEqual(cdp.erros, []);
});
