import assert from "node:assert/strict";
import test from "node:test";
import { abrirChromeLocal, ate, chrome } from "./helpers/chrome-local";

type Estado = { itens: { id: number; nome: string }[]; carregando: boolean; completo: boolean; erro: string };
test("catálogo compartilhado: carga Ref, cache da tela, retomada e isolamento", { skip: chrome ? false : "Chrome indisponível", timeout: 90_000 }, async t => {
  const { cdp, url } = await abrirChromeLocal(t, "tests/fixtures/catalogo-tecidos-olist-browser.tsx");
  const avaliar = <T,>(codigo: string) => cdp.avaliar<T>(codigo);
  const clicar = (nome: string) => avaliar(`[...document.querySelectorAll("button")].find(e=>e.textContent===${JSON.stringify(nome)}).click()`);
  const estado = () => avaliar<Estado>('JSON.parse(document.querySelector("#estado").textContent)');
  const consultas = () => avaliar<number>("window.catalogoTeste.consultas.length");
  let rodada = 0;
  async function abrir(extra = "") {
    await cdp.pedir("Page.navigate", { url: `${url}?rodada=${++rodada}${extra}` });
    await ate(() => avaliar<boolean>('Boolean(document.querySelector("#estado"))'), "Catálogo não montou");
  }
  const pronto = () => ate(async () => (await estado()).completo, "Catálogo não concluiu");
  const responder = (indice: number, id: number, pagina = 1, mais = false) => avaliar(`window.catalogoTeste.responder(${indice},{itens:[{id:${id},nome:"Tecido Ref. ${id}",preco:18.99}],pagina:${pagina},mais:${mais}})`);

  await t.test("carrega todas as páginas Ref uma vez e reaproveita contexto renovado e etapas", async () => {
    await abrir(); await pronto();
    assert.equal((await estado()).itens.length, 52);
    assert.equal(await consultas(), 2);
    assert.equal(await avaliar("window.catalogoTeste.maxAtivas"), 1, "Páginas não são disparadas em paralelo");
    assert.equal(await avaliar('window.catalogoTeste.consultas.every(c=>new URL(c.url).searchParams.get("busca")==="ref"&&new URL(c.url).searchParams.get("recurso")==="produtos")'), true);
    assert.deepEqual(await avaliar('window.catalogoTeste.consultas.map(c=>new URL(c.url).searchParams.get("pagina"))'), ["1", "2"]);
    await clicar("Alternar etapa"); await clicar("Alternar etapa"); await clicar("Renovar contexto");
    await avaliar("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await consultas(), 2, "Renovar assinatura/etapa não reconsulta catálogo pronto");
    await clicar("Desativar"); await clicar("Reativar"); await pronto();
    assert.equal(await consultas(), 2, "Suspensão temporária não descarta a lista pronta");
    await clicar("Atualizar catálogo");
    await ate(async () => await consultas() === 4 && (await estado()).completo, "Atualização explícita não recarregou");
    assert.equal(await avaliar('new URL(window.catalogoTeste.consultas[2].url).searchParams.get("contextoConsulta")'), "assinado-2");
  });
  await t.test("sem conta ativa aguarda e catálogo vazio não entra em loop", async () => {
    await abrir("&inativo=1&modo=vazio");
    assert.equal(await consultas(), 0);
    await clicar("Reativar"); await pronto();
    assert.equal((await estado()).itens.length, 0);
    assert.equal(await consultas(), 1);
    await clicar("Alternar etapa"); await clicar("Alternar etapa");
    assert.equal(await consultas(), 1);
  });
  await t.test("reexecução do efeito no StrictMode reinicia a carga abortada e conclui", async () => {
    await abrir("&strict=1"); await pronto();
    assert.equal((await estado()).carregando, false);
    assert.equal((await estado()).itens.length, 52);
    assert.equal(await avaliar("window.catalogoTeste.consultas[0].signal.aborted"), true);
    assert.deepEqual(await avaliar('window.catalogoTeste.consultas.map(c=>new URL(c.url).searchParams.get("pagina"))'), ["1", "1", "2"]);
  });
  await t.test("renovar contexto durante a carga usa a nova assinatura na página seguinte", async () => {
    await abrir("&adiar=1");
    await ate(async () => await consultas() === 1, "Primeira página não começou");
    await clicar("Renovar contexto");
    await avaliar("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await consultas(), 1, "A assinatura não reinicia a primeira página em andamento");
    assert.equal(await avaliar("window.catalogoTeste.consultas[0].signal.aborted"), false);
    await responder(0, 111, 1, true);
    await ate(async () => await consultas() === 2, "Segunda página não começou");
    assert.equal(await avaliar('new URL(window.catalogoTeste.consultas[1].url).searchParams.get("contextoConsulta")'), "assinado-2");
    assert.deepEqual(await avaliar('window.catalogoTeste.consultas.map(c=>new URL(c.url).searchParams.get("pagina"))'), ["1", "2"]);
    await responder(1, 222, 2); await pronto();
    assert.deepEqual((await estado()).itens.map(item => item.id), [111, 222]);
  });
  await t.test("erro de página conserva opções e retoma explicitamente sem repetir primeira página", async () => {
    await abrir("&modo=erro");
    await ate(async () => Boolean((await estado()).erro), "Falha não foi exposta");
    assert.equal((await estado()).completo, false);
    assert.equal((await estado()).itens.length, 50);
    assert.equal(await consultas(), 2);
    await clicar("Continuar carregamento"); await pronto();
    assert.equal((await estado()).itens.length, 52);
    assert.equal(await consultas(), 3);
    assert.equal(await avaliar('new URL(window.catalogoTeste.consultas[2].url).searchParams.get("pagina")'), "2");
  });
  await t.test("timeout libera carga pendente, conserva progresso e retoma somente a página que falhou", async () => {
    await abrir("&modo=pendente&prazoCurto=1");
    await ate(async () => Boolean((await estado()).erro), "Consulta pendente não expirou");
    assert.equal((await estado()).carregando, false);
    assert.equal((await estado()).completo, false);
    assert.equal((await estado()).itens.length, 50);
    assert.match((await estado()).erro, /demorou/);
    assert.equal(await consultas(), 2, "Não repete automaticamente a página que expirou");
    assert.equal(await avaliar("window.catalogoTeste.consultas[1].signal.aborted"), true);
    await clicar("Continuar carregamento");
    await ate(async () => await consultas() === 3, "Retomada não iniciou");
    assert.equal(await avaliar('new URL(window.catalogoTeste.consultas[2].url).searchParams.get("pagina")'), "2");
    await responder(1, 999, 2, true);
    assert.equal((await estado()).itens.some(item => item.id === 999), false, "Ignora a resposta atrasada que expirou");
    await responder(2, 5168, 2); await pronto();
    assert.equal((await estado()).itens.length, 51);
    assert.equal(await consultas(), 3, "Resposta antiga não inicia a terceira página");
  });
  await t.test("cancelamento libera imediatamente e uma resposta tardia não publica nem avança páginas", async () => {
    await abrir("&modo=pendente");
    await ate(async () => await consultas() === 2, "Segunda página não começou");
    await clicar("Cancelar carregamento");
    await ate(async () => !(await estado()).carregando, "Cancelamento não liberou a carga");
    assert.equal((await estado()).itens.length, 50);
    assert.equal((await estado()).completo, false);
    assert.match((await estado()).erro, /cancelado/);
    assert.equal(await avaliar("window.catalogoTeste.consultas[1].signal.aborted"), true);
    await responder(1, 999, 2, true);
    await avaliar("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await consultas(), 2, "Cancelamento não inicia consultas por conta própria");
    assert.equal((await estado()).itens.some(item => item.id === 999), false);
    await clicar("Continuar carregamento");
    await ate(async () => await consultas() === 3, "Não permitiu retomar após cancelar");
    assert.equal(await avaliar('new URL(window.catalogoTeste.consultas[2].url).searchParams.get("pagina")'), "2");
    await responder(2, 5168, 2); await pronto();
    assert.equal((await estado()).itens.length, 51);
  });
  await t.test("limita o ciclo automático e não apresenta carga parcial como completa", async () => {
    await abrir("&modo=longo");
    await ate(async () => await consultas() === 20 && !(await estado()).carregando, "Carga não respeitou bloco limitado");
    assert.equal((await estado()).completo, false);
    assert.equal((await estado()).itens.length, 20);
    await clicar("Continuar carregamento"); await pronto();
    assert.equal(await consultas(), 21);
    assert.equal((await estado()).itens.length, 21);
  });
  await t.test("trocas de conta, origem, usuário e token abortam e descartam respostas antigas", async () => {
    for (const acao of ["Trocar conta", "Trocar origem", "Trocar usuário", "Trocar token"]) {
      await abrir("&adiar=1");
      await ate(async () => await consultas() === 1, "Consulta antiga não começou");
      await clicar(acao);
      await ate(async () => await consultas() === 2, "Novo escopo não consultou");
      assert.equal(await avaliar("window.catalogoTeste.consultas[0].signal.aborted"), true);
      await responder(1, 222); await pronto();
      await responder(0, 111);
      assert.deepEqual((await estado()).itens.map(item => item.id), [222]);
      if (acao === "Trocar token") assert.equal(await avaliar("window.catalogoTeste.consultas[1].token"), "Bearer token-2");
    }
  });
  await t.test("desativação e desmontagem abortam sem aceitar resposta tardia", async () => {
    await abrir("&adiar=1");
    await ate(async () => await consultas() === 1, "Consulta não começou");
    await clicar("Desativar");
    await ate(() => avaliar<boolean>("window.catalogoTeste.consultas[0].signal.aborted"), "Desativação não abortou");
    await responder(0, 111);
    assert.equal((await estado()).itens.length, 0);
    await clicar("Reativar");
    await ate(async () => await consultas() === 2, "Reativação não consultou");
    await clicar("Remover hook");
    await ate(() => avaliar<boolean>("window.catalogoTeste.consultas[1].signal.aborted"), "Desmontagem não abortou");
    await responder(1, 222); await clicar("Reabrir hook");
    await ate(async () => await consultas() === 3, "Remontagem não iniciou lista própria");
    await responder(2, 333); await pronto();
    assert.deepEqual((await estado()).itens.map(item => item.id), [333]);
  });
  assert.deepEqual(cdp.erros, []);
});
