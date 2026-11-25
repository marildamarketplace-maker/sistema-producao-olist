import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

const solicitacaoId = "00000000-0000-0000-0000-000000000050";
test("pedido de produção: edição livre preserva origem, contexto e recuperação do aceite", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/pedido-manual-browser.tsx", [{ name: "link-local", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve("tests/fixtures/olist-empresa-link.tsx") }));
  } }]);
  const avaliar = <T,>(code: string) => cdp.avaliar<T>(code);
  const botao = (nome: string) => `[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(nome)})`;
  const clicar = async (nome: string) => { await avaliar(`${botao(nome)}.click()`); };
  const etapa = (nome: string) => ate(() => avaliar<boolean>(`document.querySelector("section h3")?.textContent===${JSON.stringify(nome)}`), `Etapa ${nome} indisponível`);
  const campo = (nome: string) => `[...document.querySelectorAll("label")].find(l=>l.textContent.startsWith(${JSON.stringify(nome)}))?.querySelector("input")`;
  const preencher = (nome: string, valor: string) => avaliar(`{const e=${campo(nome)};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(valor)});e.dispatchEvent(new Event("input",{bubbles:true}));}`);
  let rodada = 0;
  async function abrir(extra = "") {
    await cdp.pedir("Page.navigate", { url: `${url}?solicitacaoId=${solicitacaoId}&rodada=${++rodada}${extra}` });
    await ate(() => avaliar<boolean>(`Boolean(window.testeManual) && (Boolean(${botao("Confirmar resultado")}) || (Boolean(${botao("Continuar")}) && !${botao("Continuar")}.disabled))`), "Referência não carregou");
  }
  async function produtos() {
    await clicar("Continuar"); await etapa("Cliente"); await clicar("Buscar");
    await ate(() => avaliar<boolean>('document.querySelector("select")?.options.length===2'), "Cliente não carregou");
    await avaliar('{const e=document.querySelector("select");e.value="30";e.dispatchEvent(new Event("change",{bubbles:true}));}');
    await clicar("Continuar"); await etapa("Aplicativo");
    await ate(() => avaliar<boolean>(`!${botao("Continuar")}.disabled`), "Destino e origem não carregaram");
    await clicar("Continuar"); await etapa("Itens");
  }
  for (const width of [360, 1440]) for (const tema of ["light", "dark"]) await t.test(`${width}px ${tema}: editar, remover e adicionar`, async () => {
    await cdp.pedir("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await abrir(`&tema=${tema}`); await produtos();
    assert.equal(await avaliar(`${campo("Tecido")}.value`), "Oxford da produção 1");
    assert.equal(await avaliar('document.querySelectorAll("fieldset").length'), 2);
    await preencher("Quantidade de peças", "8"); await clicar("Remover item 2"); await clicar("Adicionar item");
    await avaliar('{const inputs=[...document.querySelectorAll("label")].filter(l=>l.textContent.startsWith("Tecido")).map(l=>l.querySelector("input"));const e=inputs[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Oxford adicionado");e.dispatchEvent(new Event("input",{bubbles:true}));}');
    await clicar("Continuar"); await etapa("Dados comerciais"); await clicar("Voltar"); await etapa("Itens");
    assert.equal(await avaliar(`${campo("Quantidade de peças")}.value`), "8");
    await clicar("Continuar"); await clicar("Continuar"); await etapa("Revisão");
    assert.equal(await avaliar('document.documentElement.scrollWidth<=innerWidth'), true);
    await clicar("Enviar para fila"); await ate(() => avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'), "Aceite ausente");
    assert.equal(await avaliar('window.testeManual.envios.length'), 1);
    assert.equal(await avaliar('window.testeManual.envios[0].revisaoProducao'), "a".repeat(64));
    assert.equal(await avaliar('window.testeManual.envios[0].itens[0].quantidade'), 8);
    assert.equal(await avaliar('window.testeManual.envios[0].itens[1].tecidoNome'), "Oxford adicionado");
    assert.notEqual(await avaliar('window.testeManual.envios[0].itens[1].id'), "00000000-0000-0000-0000-000000000041");
    assert.equal(await avaliar(`window.testeManual.consultas.every(q=>new URLSearchParams(q).get("solicitacaoId")===${JSON.stringify(solicitacaoId)})`), true);
    assert.equal(await avaliar('new URLSearchParams(location.search).get("solicitacaoId")'), solicitacaoId);
    assert.equal(await avaliar(`${botao("Criar outro pedido")}===undefined`), true);
    assert.equal(await avaliar('Boolean([...document.querySelectorAll("a")].find(a=>a.getAttribute("href")==="/solicitacoes-producao"))'), true);
  });
  await t.test("falha de rede recupera a mesma confirmação após reload", async () => {
    await abrir(); await produtos(); await clicar("Continuar"); await clicar("Continuar"); await etapa("Revisão");
    await avaliar('window.testeManual.falhar=true'); await clicar("Enviar para fila");
    await ate(() => avaliar<boolean>(`Boolean(${botao("Confirmar resultado")})`), "Tentativa não preservada");
    const chave = await avaliar<string>('window.testeManual.envios[0].chaveIdempotencia');
    await abrir("&preservar=1"); await clicar("Confirmar resultado");
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Pedido registrado na fila")'), "Tentativa não recuperada");
    assert.equal(await avaliar('window.testeManual.envios[0].chaveIdempotencia'), chave);
    assert.equal(await avaliar('window.testeManual.envios[0].revisaoProducao'), "a".repeat(64));
  });
  await t.test("alteração da origem exige recarregar explicitamente sem sobrescrever a edição", async () => {
    await abrir("&fornecedor=1"); await produtos();
    await preencher("Quantidade de peças", "15");
    await clicar("Voltar"); await clicar("Voltar"); await clicar("Voltar"); await etapa("Vendedor");
    await avaliar('{window.testeManual.fonteAtual="c".repeat(64);const e=document.querySelector("select");e.value="00000000-0000-0000-0000-000000000005";e.dispatchEvent(new Event("change",{bubbles:true}));}');
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Suas edições foram preservadas")'), "Conflito da origem não apareceu");
    assert.equal(await avaliar('window.testeManual.envios.length'), 0);
    await clicar("Descartar edições e recarregar dados da produção");
    await ate(() => avaliar<boolean>('!document.body.innerText.includes("Suas edições foram preservadas")'), "Recarga explícita não limpou conflito");
    await ate(() => avaliar<boolean>(`!${botao("Continuar")}.disabled`), "Referência não recuperou");
    await produtos();
    assert.equal(await avaliar(`${campo("Quantidade de peças")}.value`), "3");
  });
  await t.test("sem fornecedor não inicia consultas e sem vendedor mantém contas desabilitadas com motivo", async () => {
    await cdp.pedir("Page.navigate", { url: `${url}?solicitacaoId=${solicitacaoId}&disponibilidade=semFornecedor&rodada=${++rodada}` });
    await ate(() => avaliar<boolean>('document.body.innerText.includes("Nenhum fornecedor autorizado disponível")'), "Ausência de fornecedor não foi informada");
    assert.equal(await avaliar('window.testeManual.consultas.length'), 1);
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`), true);
    await cdp.pedir("Page.navigate", { url: `${url}?solicitacaoId=${solicitacaoId}&disponibilidade=semVendedor&rodada=${++rodada}` });
    await ate(() => avaliar<boolean>('Boolean([...document.querySelectorAll("[aria-label]")].find(e=>e.getAttribute("aria-label")==="Contas bloqueadas"))'), "Contas bloqueadas não carregaram");
    assert.equal(await avaliar('[...document.querySelector("select").options].filter(o=>o.value).every(o=>o.disabled)'), true);
    assert.equal(await avaliar('window.testeManual.consultas.length'), 1);
    assert.equal(await avaliar(`${botao("Continuar")}.disabled`), true);
    await cdp.pedir("Page.bringToFront");
    await avaliar('[...document.querySelectorAll("[aria-label]")].find(e=>e.getAttribute("aria-label")==="Contas bloqueadas").querySelector("[tabindex]").focus()');
    await ate(() => avaliar<boolean>('getComputedStyle(document.querySelector("[role=tooltip]")).display!=="none"'), "Motivo de bloqueio não abriu por foco");
    assert.match(await avaliar<string>('document.querySelector("[role=tooltip]").textContent'), /Vendedor não vinculado/);
  });
  await t.test("seleciona conta habilitada e reaproveita contexto nas pesquisas sem perder edição ao atualizar", async () => {
    await abrir("&disponibilidade=parcial");
    assert.equal(await avaliar('document.querySelector("select").value'), "00000000-0000-0000-0000-000000000007");
    assert.equal(await avaliar('window.testeManual.consultas.some(q=>new URLSearchParams(q).get("aplicativoId")==="00000000-0000-0000-0000-000000000005")'), false);
    await produtos(); await preencher("Quantidade de peças", "17");
    await avaliar('[...document.querySelectorAll("button[aria-label]")].find(e=>e.getAttribute("aria-label")==="Procurar nome do tecido na Olist").click()');
    await ate(() => avaliar<boolean>('window.testeManual.consultas.some(q=>new URLSearchParams(q).get("contextoConsulta")==="contexto-validado-local")'), "Pesquisa não reutilizou contexto autorizado");
    const antes = await avaliar<number>('window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="resolver").length');
    await clicar("Atualizar direcionamento");
    await ate(() => avaliar<boolean>(`window.testeManual.consultas.filter(q=>new URLSearchParams(q).get("acao")==="resolver").length>${antes} && !${botao("Continuar")}.disabled`), "Direcionamento não foi renovado");
    assert.equal(await avaliar(`${campo("Quantidade de peças")}.value`), "17");
  });
  assert.deepEqual(cdp.erros, []);
});
