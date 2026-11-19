import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as aguardar } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Chrome é um pré-requisito de runtime, não uma dependência npm. Para CI Linux:
// OLIST_SYNC_TEST_CHROME_PATH=/usr/bin/chromium node --import tsx --test tests/olist-sync-ui-browser.test.ts
const chrome = [process.env.OLIST_SYNC_TEST_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((caminho): caminho is string => Boolean(caminho && existsSync(caminho)));
const raiz = fileURLToPath(new URL("../", import.meta.url));

type RespostaCdp = { id?: number; result?: Record<string, unknown>; error?: { message: string } };
class ChromeDevTools {
  private id = 0;
  private pendentes = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", event => {
      const mensagem = JSON.parse(String(event.data)) as RespostaCdp;
      const pendente = mensagem.id ? this.pendentes.get(mensagem.id) : undefined;
      if (!pendente) return;
      clearTimeout(pendente.timer); this.pendentes.delete(mensagem.id!);
      if (mensagem.error) pendente.reject(new Error(mensagem.error.message));
      else pendente.resolve(mensagem.result ?? {});
    });
  }
  pedir(metodo: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendentes.delete(id); reject(new Error(`Chrome não respondeu: ${metodo}`)); }, 5_000);
      this.pendentes.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method: metodo, params }));
    });
  }
  async avaliar<T>(expression: string): Promise<T> {
    const resposta = await this.pedir("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(resposta.exceptionDetails, undefined, `Erro no navegador: ${JSON.stringify(resposta.exceptionDetails)}`);
    return (resposta.result as { value: T }).value;
  }
  fechar() {
    for (const p of this.pendentes.values()) { clearTimeout(p.timer); p.reject(new Error("Teste encerrado")); }
    this.pendentes.clear(); this.socket.close();
  }
}

async function ate(condicao: () => Promise<boolean>, mensagem: string, limite = 5_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limite) { if (await condicao()) return; await aguardar(25); }
  assert.fail(mensagem);
}

test("UI real: previsão manual, polling e sincronização incremental", { skip: chrome ? false : "Chrome/Chromium não está instalado; configure OLIST_SYNC_TEST_CHROME_PATH", timeout: 45_000 }, async t => {
  const pasta = await mkdtemp(path.join(tmpdir(), "olist-sync-ui-test-"));
  const conexao: { cdp?: ChromeDevTools } = {};
  const navegador = spawn(chrome!, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-features=MediaRouter", "--remote-debugging-port=0", `--user-data-dir=${path.join(pasta, "profile")}`, "about:blank"], { stdio: "ignore" });
  let falhaNavegador: Error | undefined;
  navegador.on("error", error => { falhaNavegador = error; });
  t.after(async () => {
    conexao.cdp?.fechar(); navegador.kill("SIGTERM");
    for (let i = 0; i < 20 && navegador.exitCode === null && navegador.signalCode === null; i++) await aguardar(50);
    if (navegador.exitCode === null && navegador.signalCode === null) navegador.kill("SIGKILL");
    await rm(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await build({
    entryPoints: [path.join(raiz, "tests/fixtures/olist-sync-browser.tsx")], outfile: path.join(pasta, "app.js"),
    bundle: true, platform: "browser", jsx: "automatic", tsconfig: path.join(raiz, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "sessao-local", setup(builder) {
      builder.onResolve({ filter: /^@\/components\/auth-provider$/ }, () => ({ path: "auth", namespace: "teste-local" }));
      builder.onLoad({ filter: /.*/, namespace: "teste-local" }, () => ({ contents: 'export const useAuth = () => ({session:{access_token:"teste-local"},usuario:{podeVisualizarSincronizacaoOlist:true,podeExecutarSincronizacaoOlist:true,podeResolverSincronizacaoOlist:true,podeConfigurarSincronizacaoOlist:true}});', loader: "js" }));
    } }],
  });
  await promisify(execFile)(process.execPath, [path.join(raiz, "node_modules/tailwindcss/lib/cli.js"), "-i", path.join(raiz, "src/app/globals.css"), "-o", path.join(pasta, "style.css"), "--minify"], { cwd: raiz });
  await writeFile(path.join(pasta, "index.html"), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./style.css"><title>Teste local Olist</title><body><div id="root"></div><script src="./app.js"></script></body></html>');
  const portaArquivo = path.join(pasta, "profile/DevToolsActivePort");
  await ate(async () => {
    if (falhaNavegador) throw falhaNavegador;
    assert.equal(navegador.exitCode, null, `Chrome terminou antes de iniciar (exit ${navegador.exitCode}, sinal ${navegador.signalCode}); execute o teste em ambiente que permita Chrome headless.`);
    assert.equal(navegador.signalCode, null, `Chrome foi interrompido (${navegador.signalCode}); execute o teste em ambiente que permita Chrome headless.`);
    return existsSync(portaArquivo);
  }, "Chrome não iniciou a porta local do DevTools", 8_000);
  const porta = (await readFile(portaArquivo, "utf8")).split("\n")[0];
  assert.match(porta, /^\d+$/);
  const alvos = await fetch(`http://127.0.0.1:${porta}/json/list`, { signal: AbortSignal.timeout(3_000) }).then(r => r.json()) as { type: string; webSocketDebuggerUrl: string }[];
  const pagina = alvos.find(alvo => alvo.type === "page"); assert.ok(pagina);
  const socket = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Timeout ao conectar no Chrome local")); }, 3_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Falha no Chrome local")); }, { once: true });
  });
  const cdp = new ChromeDevTools(socket); conexao.cdp = cdp;
  await cdp.pedir("Page.enable");
  for (const largura of [390, 1280]) for (const tema of ["claro", "escuro"]) {
    await t.test(`previsão manual e conclusão em ${largura}px, tema ${tema}`, async () => {
      const navegadorLocal = cdp;
      await navegadorLocal.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 600 });
      await navegadorLocal.pedir("Page.navigate", { url: `${pathToFileURL(path.join(pasta, "index.html")).href}?viewport=${largura}&tema=${tema}` });
      await ate(() => navegadorLocal.avaliar<boolean>('!!window.olistSyncTeste && [...document.querySelectorAll("button")].some(b => b.textContent === "Execuções")'), "Painel não carregou");
      await navegadorLocal.avaliar(`document.documentElement.classList.toggle("dark", ${tema === "escuro"})`);
      await navegadorLocal.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Execuções").click()');
      await ate(() => navegadorLocal.avaliar<boolean>('[...document.querySelectorAll("button")].some(b => b.textContent === "Detalhes" && !b.disabled)'), "Lista não carregou");
      await ate(() => navegadorLocal.avaliar<boolean>('document.querySelector("article")?.textContent.includes("Fim previsto da validação") ?? false'), "Previsão não apareceu no card");
      assert.equal(await navegadorLocal.avaliar('document.documentElement.scrollWidth <= innerWidth'), true, "Previsão não deve criar overflow da página");
      const captura = await navegadorLocal.pedir("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(tmpdir(), `olist-previsao-${largura}-${tema}.png`), Buffer.from(String(captura.data), "base64"));
      assert.equal(await navegadorLocal.avaliar('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length'), 1);
      await aguardar(180);
      assert.equal(await navegadorLocal.avaliar('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length'), 1, "Polling não pode consultar a previsão");
      await navegadorLocal.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Atualizar").click()');
      await ate(() => navegadorLocal.avaliar<boolean>('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length === 2'), "Atualizar não renovou a previsão");
      await ate(() => navegadorLocal.avaliar<boolean>('[...document.querySelectorAll("button")].some(b => b.textContent === "Detalhes" && !b.disabled)'), "Lista não recarregou");
      await navegadorLocal.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Detalhes").click()');
      await ate(() => navegadorLocal.avaliar<boolean>('document.querySelector("[role=dialog]")?.textContent.includes("Auditando") ?? false'), "Detalhe ativo não abriu");
      await navegadorLocal.avaliar("window.olistSyncTeste.concluir()");
      await ate(() => navegadorLocal.avaliar<boolean>("window.olistSyncTeste.detalheFinalRespondido || window.olistSyncTeste.detalheFinalAbortado"), "Polling não consultou o resultado final");
      await aguardar(150);
      const resultado = await navegadorLocal.avaliar<{ dialogo: string; cancelamento: boolean; listaConcluida: boolean; chamadas: number; abortado: boolean }>('({ dialogo: document.querySelector("[role=dialog]")?.textContent ?? "", cancelamento: [...document.querySelectorAll("[role=dialog] button")].some(b => b.textContent === "Solicitar cancelamento"), listaConcluida: [...document.querySelectorAll("article")].some(a => a.textContent.includes("Concluída")), chamadas: window.olistSyncTeste.chamadas.length, abortado: window.olistSyncTeste.detalheFinalAbortado })');
      assert.match(resultado.dialogo, /Concluída/, `O resumo terminou, mas o detalhe não atualizou; consulta final abortada=${resultado.abortado}`);
      assert.equal(resultado.cancelamento, false, "Uma execução concluída não pode oferecer cancelamento");
      assert.equal(resultado.listaConcluida, true, "A lista deve refletir a execução concluída");
      assert.equal(await navegadorLocal.avaliar('document.querySelector("article")?.textContent.includes("Fim previsto da validação") ?? false'), false, "Execução concluída não conserva a previsão antiga");
      assert.equal(await navegadorLocal.avaliar('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length'), 2, "Conclusão e modal não podem consultar a previsão");
      assert.match(resultado.dialogo, /Leitura efetiva: Incremental/);
      assert.match(resultado.dialogo, /Alterações desde:/);
      assert.match(resultado.dialogo, /detalhados: 4/);
      await aguardar(200);
      assert.equal(await navegadorLocal.avaliar("window.olistSyncTeste.chamadas.length"), resultado.chamadas, "Polling precisa encerrar após a conclusão");
    });
    await t.test(`automático, completa e validação por empresa em ${largura}px`, async () => {
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await ate(() => cdp.avaliar<boolean>('!document.querySelector("[role=dialog]")'), "Escape não fechou o detalhe");
      await ate(() => cdp.avaliar<boolean>('document.activeElement?.textContent === "Detalhes"'), "Escape não restaurou o foco do gatilho");
      for (const completa of [false, true]) {
        await cdp.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Nova execução").click()');
        await ate(() => cdp.avaliar<boolean>('!!document.querySelector("[role=dialog] input[type=checkbox]")'), "Nova execução não abriu");
        assert.equal(await cdp.avaliar('document.querySelector("[role=dialog] input[type=checkbox]").checked'), false);
        if (completa) await cdp.avaliar('document.querySelector("[role=dialog] input[type=checkbox]").click()');
        await cdp.avaliar('document.querySelector("[role=dialog] button[type=submit]").click()');
        await ate(() => cdp.avaliar<boolean>('!document.querySelector("[role=dialog]")'), "Enfileiramento não terminou");
        assert.equal(await cdp.avaliar('window.olistSyncTeste.mutacoes.at(-1).dados.completa'), completa);
        assert.equal(await cdp.avaliar('window.olistSyncTeste.mutacoes.at(-1).dados.modo'), "AUDITAR");
      }
      await cdp.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Configuração").click()');
      await ate(() => cdp.avaliar<boolean>('!!document.querySelector("details")'), "Configuração incremental não apareceu");
      assert.match(await cdp.avaliar<string>('document.body.innerText'), /Alterações por lote, entidade e destino/);
      assert.match(await cdp.avaliar<string>('document.body.innerText'), /a fila continua na mesma execução, sem repetir a coleta/);
      for (const escuro of [false, true]) {
        await cdp.avaliar(`document.documentElement.classList.toggle("dark", ${escuro})`);
        assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= window.innerWidth'), true, `Overflow em ${largura}px, escuro=${escuro}`);
      }
      await cdp.avaliar('document.querySelector("details").open = true; const select = document.querySelector("details select"); select.value = "VALIDAR"; select.dispatchEvent(new Event("change", {bubbles:true}))');
      await ate(() => cdp.avaliar<boolean>('!!document.querySelector("details textarea")'), "Campos de evidência não apareceram");
      assert.equal(await cdp.avaliar('document.querySelector("details input").value'), "", "Fuso não é certificado por default");
      await cdp.avaliar('const fuso = document.querySelector("details input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(fuso,"America/Sao_Paulo"); fuso.dispatchEvent(new Event("input",{bubbles:true})); const evidencia = document.querySelector("details textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(evidencia,"Cadastro antigo atualizado, inativação, exclusão, limites de data e paginação conferidos."); evidencia.dispatchEvent(new Event("input",{bubbles:true}))');
      await cdp.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Salvar configuração").click()');
      await ate(() => cdp.avaliar<boolean>('window.olistSyncTeste.mutacoes.some(m => m.recurso === "configuracao")'), "Validação não foi enviada");
      const dados = await cdp.avaliar<{ incrementalValidacoes: { aplicativoId: string; entidade: string; validado: boolean; fusoHorario: string; versaoContrato: number; evidencia: string }[] }>('window.olistSyncTeste.mutacoes.find(m => m.recurso === "configuracao").dados');
      assert.equal(dados.incrementalValidacoes.length, 1);
      assert.equal(dados.incrementalValidacoes[0].aplicativoId, "00000000-0000-0000-0000-000000000004");
      assert.equal(dados.incrementalValidacoes[0].entidade, "PRODUTO"); assert.equal(dados.incrementalValidacoes[0].validado, true);
      assert.equal(dados.incrementalValidacoes[0].fusoHorario, "America/Sao_Paulo"); assert.equal(dados.incrementalValidacoes[0].versaoContrato, 1);
      assert.match(dados.incrementalValidacoes[0].evidencia, /Cadastro antigo/);
      assert.ok(!JSON.stringify(dados).includes("contaIdentidade"));
    });
    await t.test(`fila existente aplica sem coletar, com layout e teclado em ${largura}px`, async () => {
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await ate(() => cdp.avaliar<boolean>('!document.querySelector("[role=dialog]")'), "Detalhe não fechou");
      await cdp.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Visão geral").click()');
      await ate(() => cdp.avaliar<boolean>('[...document.querySelectorAll("section")].some(s => s.getAttribute("aria-label") === "Resumo do processamento")'), "Resumo não apareceu");
      assert.match(await cdp.avaliar<string>('document.body.innerText'), /Aguardando aplicação/);
      assert.match(await cdp.avaliar<string>('document.body.innerText'), /Aguardando confirmação/);
      const getBotao='[...document.querySelectorAll("button")].find(b => b.textContent === "Processar fila existente")';
      assert.equal(await cdp.avaliar(`${getBotao}?.disabled`), true, "Validações pendentes devem bloquear a aplicação");
      await cdp.avaliar('window.olistSyncTeste.liberarAplicacao(); [...document.querySelectorAll("button")].find(b => b.textContent === "Atualizar").click()');
      await ate(() => cdp.avaliar<boolean>(`${getBotao}?.disabled === false`), "Fila não foi liberada");
      for (const escuro of [false,true]) {
        await cdp.avaliar(`document.documentElement.classList.toggle("dark", ${escuro})`);
        assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= window.innerWidth'), true, "Fila não pode transbordar no mobile");
      }
      const previsoesAntes=await cdp.avaliar<number>('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length');
      await cdp.pedir("Page.bringToFront");
      await cdp.pedir("Emulation.setFocusEmulationEnabled",{enabled:true});
      await cdp.avaliar(`${getBotao}.scrollIntoView(); ${getBotao}.focus();`);
      assert.equal(await cdp.avaliar("document.activeElement?.textContent"),"Processar fila existente");
      await cdp.pedir("Input.dispatchKeyEvent", {type:"rawKeyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      await cdp.pedir("Input.dispatchKeyEvent", {type:"char",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13});
      await cdp.pedir("Input.dispatchKeyEvent", {type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
      await ate(() => cdp.avaliar<boolean>('window.olistSyncTeste.mutacoes.at(-1)?.dados.modo === "APLICAR"'), "Teclado não iniciou a fila existente");
      assert.equal(await cdp.avaliar('window.olistSyncTeste.mutacoes.at(-1).dados.completa'),false);
      assert.equal(await cdp.avaliar('window.olistSyncTeste.chamadas.filter(c => c === "previsao").length'),previsoesAntes,"Iniciar aplicação não recalcula previsão");
    });
  }
});
