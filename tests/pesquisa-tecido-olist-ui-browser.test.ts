import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

const nomeCompleto = "FOURWAY SUBLIME 3 95%POLI5%ELASTRef. 5168 1J3B4C6D2B";

test("seletor de tecido: catálogo local, filtro, escolha e paginação sem requisições", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pesquisa-tecido-olist-browser.tsx");
  await cdp.pedir("Emulation.setFocusEmulationEnabled", { enabled: true });
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  const botao = (texto: string) => `[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===${JSON.stringify(texto)})`;
  const abrirOpcoes = () => avaliar('document.querySelector(\'button[aria-label="Selecionar tecido"]\').click()');
  const preencher = (nome: string) => avaliar(`{const e=document.querySelector("#nome");e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(nome)});e.dispatchEvent(new Event("input",{bubbles:true}));}`);
  const abrir = async (tema = "light", estado = "completo") => {
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}&estado=${estado}&rodada=${Math.random()}` });
    await ate(() => avaliar<boolean>('Boolean(document.querySelector("#nome"))'), "Seletor não abriu");
  };
  const id = () => avaliar<number>('JSON.parse(document.querySelector("#selecao").textContent).produtoId');
  const duasOpcoes = () => ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===2'), "As duas opções FOURWAY não apareceram");
  async function ativar(seletor: string, width: number) {
    if (width < 768) {
      const posicao = await avaliar<{ x: number; y: number }>(`(()=>{const e=${seletor};e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [posicao] });
      await cdp.pedir("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await avaliar(`${seletor}.focus()`);
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
  }

  for (const width of [360, 1440]) for (const tema of ["light", "dark"]) await t.test(`${width}px ${tema}: nomes completos e escolha por teclado/toque`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Emulation.setTouchEmulationEnabled", { enabled: width < 768 });
    await abrir(tema);
    assert.equal(await avaliar('document.querySelectorAll("section ul button").length'), 0, "Lista fechada não monta todas as opções");
    await abrirOpcoes(); await duasOpcoes();
    assert.equal(await id(), 0, "Parte do nome não autoassocia o primeiro resultado");
    assert.equal(await avaliar('[...document.querySelectorAll("section ul button")].every(e=>e.textContent.includes("Referência:")&&e.textContent.includes("ID")&&e.textContent.includes("R$"))'), true);
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    assert.equal(await avaliar('[...document.querySelectorAll("button")].every(e=>e.getBoundingClientRect().height>=44)'), true);
    if (process.env.PESQUISA_TECIDO_SCREENSHOTS === "1" && (width === 360 && tema === "dark" || width === 1440 && tema === "light")) {
      const captura = await cdp.pedir("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`/tmp/catalogo-picker-${width}-${tema}.png`, Buffer.from(String(captura.data), "base64"));
    }
    const seletor = `document.querySelector('button[aria-label=${JSON.stringify(`Selecionar ${nomeCompleto}`)}]')`;
    await ativar(seletor, width);
    await ate(async () => await id() === 5168, "Escolha não associou o FOURWAY correto");
    assert.equal(await avaliar('JSON.parse(document.querySelector("#selecao").textContent).preco'), 18.99);
    assert.equal(await avaliar('document.querySelector("#nome").value'), nomeCompleto);
    assert.equal(await avaliar('Boolean(document.querySelector(".tecido-olist-encontrado"))'), true);
    assert.equal(await avaliar('document.querySelectorAll("section ul button").length'), 0, "Escolher fecha a lista");
    assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Selecionar tecido");
    await avaliar(`${botao("Bloquear")}.click()`);
    assert.equal(await avaliar(`${botao("Limpar associação")}.disabled`), true);
    await avaliar(`${botao("Limpar associação")}.click()`);
    assert.equal(await id(), 5168, "Não permite limpar uma associação bloqueada");
    await avaliar(`${botao("Desbloquear")}.click()`);
    await ativar(botao("Limpar associação"), width);
    await ate(async () => await id() === 0, "Limpar associação não removeu o produto");
    assert.equal(await avaliar('JSON.parse(document.querySelector("#selecao").textContent).preco'), null);
    assert.equal(await avaliar('document.querySelector("#nome").value'), nomeCompleto, "Limpar associação preserva o texto");
    assert.equal(await avaliar('Boolean(document.querySelector(".tecido-olist-encontrado"))'), false);
    assert.equal(await avaliar('document.querySelector("input[type=number]")===null'), true, "Preço não permanece associado após limpar");
    assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Selecionar tecido");
    await abrirOpcoes();
    await ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===1'), "Não reabriu o produto pelo nome preservado");
    await ativar(seletor, width);
    await ate(async () => await id() === 5168, "Não conseguiu selecionar novamente após limpar");
    await preencher("5168"); await ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===1'), "Filtro por referência falhou");
    assert.equal(await id(), 0, "Alterar o nome invalida a associação anterior");
    assert.equal(await avaliar('Boolean(document.querySelector(".tecido-olist-encontrado"))'), false);
    await preencher(""); await ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===20'), "Primeira página local não ficou limitada");
    await avaliar(`${botao("Mais resultados")}.click()`);
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Página 2 de 3")'), "Segunda página local não abriu");
    assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Produtos encontrados para seleção");
    await avaliar(`${botao("Mais resultados")}.click()`);
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Página 3 de 3")'), "Última página local não abriu");
    assert.equal(await avaliar('document.querySelectorAll("section ul button").length'), 7);
    await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===0'), "Escape não fechou opções");
    assert.equal(await avaliar('document.activeElement.getAttribute("aria-label")'), "Selecionar tecido");
    await abrirOpcoes(); await avaliar('document.querySelector("#outro").focus()');
    await ate(() => avaliar<boolean>('document.querySelectorAll("section ul button").length===0'), "Sair do controle não fechou opções");
    assert.deepEqual(await avaliar("window.consultasTecidos"), [], "Filtrar, escolher e paginar não consulta a rede");
  });

  for (const estado of ["carregando", "vazio", "parcial", "erro"]) await t.test(`estado ${estado} e atualização explícita`, async () => {
    await abrir("light", estado); await abrirOpcoes();
    if (estado === "carregando") {
      assert.equal(await avaliar('document.body.innerText.includes("Carregando opções de tecido")'), true);
      assert.equal(await avaliar(`${botao("Atualizar produtos")}.disabled`), true);
      assert.equal(await avaliar(`${botao("Cancelar carregamento")}.disabled`), false);
      await avaliar(`${botao("Cancelar carregamento")}.click()`);
      await ate(() => avaliar<boolean>('document.querySelector("[role=alert]")?.textContent.includes("Carregamento cancelado")'), "Cancelamento não informou como recuperar");
      assert.equal(await avaliar("window.acoesCatalogo.cancelar"), 1);
      assert.equal(await avaliar(`${botao("Atualizar produtos")}.disabled`), false);
      assert.equal(await avaliar(`${botao("Cancelar carregamento")}===undefined`), true);
      await avaliar(`${botao("Tentar novamente")}.click()`);
      await ate(() => avaliar<boolean>('document.body.innerText.includes("47 produtos disponíveis")'), "Retentativa após cancelamento não recuperou a lista");
      assert.equal(await avaliar("window.acoesCatalogo.carregarMais"), 1);
    } else if (estado === "vazio") {
      assert.equal(await avaliar('document.body.innerText.includes("Nenhum produto corresponde ao filtro.")'), true);
      assert.equal(await avaliar(`${botao("Carregar mais produtos")}===undefined`), true);
    } else {
      assert.equal(await avaliar('document.body.innerText.includes("Carregamento incompleto")'), true);
      if (estado === "erro") assert.equal(await avaliar('document.querySelector("[role=alert]").textContent'), "Falha ao carregar a próxima página.");
      await avaliar(`${botao(estado === "erro" ? "Tentar novamente" : "Carregar mais produtos")}.click()`);
      await ate(() => avaliar<boolean>('document.body.innerText.includes("47 produtos disponíveis")'), "Ação explícita não concluiu catálogo");
      assert.equal(await avaliar("window.acoesCatalogo.carregarMais"), 1);
    }
    assert.deepEqual(await avaliar("window.consultasTecidos"), []);
  });
  assert.deepEqual(cdp.erros, []);
});
