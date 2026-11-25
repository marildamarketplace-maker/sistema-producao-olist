import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

test("pedido misto: modalidades, combinações, cálculo, ajuste e revisão em desktop/mobile", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pedido-manual-browser.tsx", [{ name: "link-local", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve("tests/fixtures/olist-empresa-link.tsx") }));
  } }]);
  const avaliar = <T,>(s: string) => cdp.avaliar<T>(s);
  const clicar = (nome: string) => avaliar(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(nome)}).click()`);
  const campo = (grupo: number, nome: string, linha = 0) => `([...document.querySelectorAll("fieldset")][${grupo}]${linha ? `.querySelectorAll('[data-item-id]')[${linha}]` : ""})`;
  const input = (g: number, nome: string, linha?: number) => `${campo(g, nome, linha)}.querySelectorAll("label")`;
  const preencher = (g: number, nome: string, valor: string, linha?: number) => avaliar(`{const e=[...${input(g, nome, linha)}].find(l=>l.textContent.startsWith(${JSON.stringify(nome)})).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(valor)});e.dispatchEvent(new Event("input",{bubbles:true}));}`);
  const escolherModalidade = (g: number, nome: string) => avaliar(`[...document.querySelectorAll("fieldset")][${g}].querySelectorAll("button")[${["Tecido sem estampa", "Tecido sublimado", "Produto sublimado"].indexOf(nome)}].click()`);
  const escolherTamanho = async (g: number, sku: string, linha = 0) => {
    const seletor = `[...document.querySelectorAll("fieldset")][${g}].querySelectorAll('[data-item-id]')[${linha}]`;
    await avaliar(`[...${seletor}.querySelectorAll("button")].find(b=>b.textContent==="Selecionar tamanho").click()`);
    await ate(() => avaliar<boolean>(`[...${seletor}.querySelectorAll("button")].some(b=>b.textContent.includes(${JSON.stringify(` · ${sku}`)}))`), "Tamanho não carregou");
    await avaliar(`[...${seletor}.querySelectorAll("button")].find(b=>b.textContent.includes(${JSON.stringify(` · ${sku}`)})).click()`);
  };
  for (const width of [390, 1440]) for (const tema of ["light", "dark"]) await t.test(`${width}px ${tema}`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await cdp.pedir("Page.navigate", { url: `${url}?tema=${tema}` });
    await ate(() => avaliar<boolean>('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar"&&!b.disabled))'), "Conta não carregou");
    await clicar("Continuar"); await clicar("Buscar");
    await ate(() => avaliar<boolean>('document.querySelector("select")?.options.length===2'), "Clientes não carregaram");
    await avaliar('{const e=document.querySelector("select");e.value="30";e.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar");
    await ate(() => avaliar<boolean>('!([...document.querySelectorAll("button")].find(b=>b.textContent==="Continuar").disabled)'), "Destino não resolveu");
    await clicar("Continuar"); await clicar("Adicionar item");
    assert.equal(await avaliar(`document.querySelector("fieldset").querySelectorAll('button[aria-pressed="true"]').length`), 0, "Item novo não tem modalidade padrão");
    assert.equal(await avaliar('document.querySelector("fieldset").querySelectorAll("input,select,textarea").length'), 0, "Formulário aguarda escolha explícita");
    await escolherModalidade(0, "Tecido sem estampa");
    await preencher(0, "Tecido", "Oxford liso"); await preencher(0, "Quantidade de tecido", "2.5");
    assert.equal(await avaliar('[...document.querySelectorAll("fieldset")][0].innerText.includes("Quantidade de peças")'), false);
    assert.equal(await avaliar('[...document.querySelectorAll("fieldset")][0].querySelectorAll("input[type=checkbox]").length'), 0);
    await clicar("Adicionar item"); await escolherModalidade(1, "Tecido sublimado");
    await preencher(1, "Tecido", "Oxford"); await preencher(1, "Estampa", "6861"); await preencher(1, "Variante", "A"); await preencher(1, "Quantidade de tecido", "3");
    await clicar("Adicionar item"); await escolherModalidade(2, "Produto sublimado");
    await preencher(2, "Tecido", "Cetim"); await preencher(2, "Estampa", "7000"); await preencher(2, "Tipo de produto", "Lenço"); await preencher(2, "Variante", "Azul");
    await preencher(2, "Quantidade de peças", "30"); await escolherTamanho(2, "70");
    const metros = () => avaliar<number>(`Number([...document.querySelectorAll("fieldset")][2].querySelector('input[step="0.000001"]').value)`);
    assert.equal(await metros(), 15);
    const antes = await avaliar<number>('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="tamanhos").length');
    await clicar("Ajustar metragem"); await preencher(2, "Quantidade de tecido", "16"); await preencher(2, "Quantidade de peças", "40");
    assert.equal(await metros(), 16); await clicar("Confirmar metragem"); await clicar("Restaurar cálculo"); assert.equal(await metros(), 20);
    assert.equal(await avaliar('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="tamanhos").length'), antes, "Alterar peças não consulta a rede");
    await clicar("Ajustar metragem"); await preencher(2, "Quantidade de tecido", "16");
    await escolherTamanho(2, "90"); assert.equal(await metros(), 16);
    await clicar("Manter ajuste"); assert.equal(await metros(), 16);
    await clicar("Restaurar cálculo"); assert.equal(await metros(), 32);
    await escolherTamanho(2, "99"); assert.equal(await metros(), 32);
    assert.equal(await avaliar('document.body.innerText.includes("Confira a metragem manual")'), true);
    await escolherTamanho(2, "70"); await clicar("Recalcular metros"); assert.equal(await metros(), 20);
    await clicar("Adicionar variante ou tamanho");
    assert.equal(await avaliar('document.querySelectorAll("fieldset").length'), 3);
    await preencher(2, "Variante", "Rosa", 1); await preencher(2, "Quantidade de peças", "20", 1); await escolherTamanho(2, "90", 1);
    await avaliar('[...document.querySelectorAll("fieldset")][2].querySelectorAll("input[type=checkbox]")[1].click()');
    assert.equal(await avaliar('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="tamanhos").length'), antes, "Combinações reaproveitam consulta de tamanhos");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    assert.equal(await avaliar('[...document.querySelectorAll("button")].filter(b=>b.offsetParent!==null).every(b=>b.getBoundingClientRect().height>=44)'), true);
    if (process.env.ITENS_PEDIDO_SCREENSHOTS_DIR) {
      const dimensoes = await avaliar<{ x: number; y: number; width: number; height: number }>('(()=>{const r=[...document.querySelectorAll("fieldset")][2].getBoundingClientRect();return {x:0,y:r.top+scrollY,width:innerWidth,height:Math.ceil(r.height)};})()');
      const captura = await cdp.pedir("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...dimensoes, scale: 1 } });
      await writeFile(path.join(process.env.ITENS_PEDIDO_SCREENSHOTS_DIR, `itens-${width}-${tema}.png`), Buffer.from(String(captura.data), "base64"));
    }
    await clicar("Continuar"); await ate(() => avaliar<boolean>('document.querySelector("section h3")?.textContent==="Dados comerciais"'), "Itens não passaram validação");
    // Destacar a primeira combinação deve funcionar mesmo quando o grupo usa seu ID.
    await avaliar(`[...document.querySelectorAll("fieldset")].find(f=>f.querySelector("legend")?.textContent==="Produto para Cetim").querySelector('button[aria-label="Selecionar tecido"]').click()`);
    await ate(() => avaliar<boolean>(`Boolean(document.querySelector('button[aria-label="Selecionar BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887"]'))`), "Produto comercial não abriu");
    await avaliar(`document.querySelector('button[aria-label="Selecionar BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887"]').click()`);
    await avaliar('{const e=[...document.querySelectorAll("fieldset")].find(f=>f.querySelector("legend")?.textContent==="Produto para BASEITWILL FOURWAY 92%POLIESTER8% Ref. 6887").querySelector("input[type=number]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"19.5");e.dispatchEvent(new Event("input",{bubbles:true}));}');
    await clicar("Voltar");
    assert.equal(await avaliar('document.querySelectorAll("fieldset").length'), 4, "Combinação base não permaneceu no grupo");
    await preencher(2, "Estampa", "7001");
    assert.equal(await avaliar('[...document.querySelectorAll("fieldset")[3].querySelectorAll("label")].find(l=>l.textContent.startsWith("Estampa")).querySelector("input").value'), "7000", "Alterar a combinação destacada preserva a estampa da outra");
    await clicar("Continuar"); await clicar("Continuar");
    await avaliar('window.testeManual.consumoAlterado=true');
    await clicar("Enviar para fila");
    await ate(() => avaliar<boolean>('document.querySelector("section h3")?.textContent==="Itens"'), "Conflito de consumo deve retornar aos itens");
    assert.equal(await avaliar(`document.querySelectorAll("fieldset")[2].querySelector('input[type=number][step="0.01"]')?.value`), "19.5", "Preço comercial deve ser preservado");
    assert.equal(await avaliar('document.querySelectorAll("fieldset")[2].innerText.includes("Selecionado:")'), true);
    await avaliar('window.testeManual.consumoAlterado=false');
    await escolherTamanho(2, "70");
    await clicar("Continuar"); await clicar("Continuar"); await clicar("Enviar para fila");
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'), "Aceite ausente");
    assert.equal(await avaliar('JSON.stringify(window.testeManual.envios[0].selecoes)===JSON.stringify(window.testeManual.envios[1].selecoes)'), true, "Recuperação mantém associações, preços, vendedor e cliente");
    assert.equal(await avaliar('window.testeManual.envios[0].aplicativoId===window.testeManual.envios[1].aplicativoId'), true);
    const itens = await avaliar<Array<{ modalidade: string; quantidade: number; quantidadeTecido: number; corteLaser: boolean }>>('window.testeManual.envios[0].itens');
    assert.deepEqual(itens.map(i => [i.modalidade, i.quantidade, i.quantidadeTecido, i.corteLaser]), [
      ["TECIDO_LISO", 0, 2.5, false], ["TECIDO_SUBLIMADO", 0, 3, false], ["PRODUTO_SUBLIMADO", 40, 20, false], ["PRODUTO_SUBLIMADO", 20, 16, true],
    ]);
  });
  assert.deepEqual(cdp.erros, []);
});
