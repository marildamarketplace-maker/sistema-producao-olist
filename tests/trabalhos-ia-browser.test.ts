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

test("Relatório IA: fluxo, polling, configuração, foco e layout responsivo", { skip: chrome ? false : "Chrome/Chromium não está instalado; configure OLIST_SYNC_TEST_CHROME_PATH", timeout: 90_000 }, async t => {
  const pasta = await mkdtemp(path.join(tmpdir(), "trabalhos-ia-ui-test-"));
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
    entryPoints: [path.join(raiz, "tests/fixtures/trabalhos-ia-browser.tsx")], outfile: path.join(pasta, "app.js"),
    bundle: true, platform: "browser", jsx: "automatic", tsconfig: path.join(raiz, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },

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
  const click = async (texto: string) => cdp.avaliar(`[...document.querySelectorAll("button")].find(b => b.textContent === ${JSON.stringify(texto)}).click()`);
  const contem = (texto: string) => cdp.avaliar<boolean>(`document.body.innerText.includes(${JSON.stringify(texto)})`);
  for (const largura of [360, 390, 1280, 1440]) for (const tema of ["claro", "escuro"]) {
    await t.test(`${largura}px ${tema}: gerar, revisar, retomar, visualizar e configurar`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 600 });
      await cdp.pedir("Page.navigate", { url: `${pathToFileURL(path.join(pasta, "index.html")).href}?largura=${largura}&tema=${tema}` });
      await ate(() => contem("Gerar relatório IA"), "Ação IA não carregou");
      await cdp.avaliar(`document.documentElement.classList.toggle("dark", ${tema === "escuro"})`);
      await click("Gerar relatório IA"); await click("Registrando…");
      await ate(() => contem("Relatório IA na fila"), "Solicitação não foi confirmada");
      assert.equal(await cdp.avaliar("window.iaTeste.gerar"), 1, "Clique duplicado deve enviar uma só solicitação");
      assert.equal(await cdp.avaliar("window.iaTeste.leituras"), 0, "Polling não carrega relatório");
      await cdp.avaliar("window.iaTeste.revisar()");
      await ate(() => contem("Revisando relatório IA"), "Revisão não apareceu");
      await cdp.avaliar("window.iaTeste.falhar()");
      await ate(() => contem("Retomar relatório IA"), "Falha não apareceu");
      await click("Retomar relatório IA");
      await ate(() => contem("Cancelar relatório IA"), "Retomada não apareceu");
      await cdp.avaliar("window.iaTeste.concluir()");
      await ate(() => contem("Ver relatório IA"), "Conclusão não apareceu");
      const consultas = await cdp.avaliar<number>("window.iaTeste.consultas"); await aguardar(240);
      assert.equal(await cdp.avaliar("window.iaTeste.consultas"), consultas, "Polling deve parar na conclusão");
      await cdp.avaliar('[...document.querySelectorAll("button")].find(b => b.textContent === "Ver relatório IA").focus()');
      await click("Ver relatório IA");
      await ate(() => contem("Fourway"), "Dados não apareceram");
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await cdp.avaliar('document.querySelectorAll("tbody tr").length'), 50);
      assert.equal(await cdp.avaliar('[...document.querySelectorAll("th")].map(x => x.textContent).join("/")'), "SKU do pedido/Produto/Tecido/Qtd");
      const captura = await cdp.pedir("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(tmpdir(), `trabalhos-ia-${largura}-${tema}.png`), Buffer.from(String(captura.data), "base64"));
      await click("Próxima"); await ate(() => cdp.avaliar<boolean>('document.querySelectorAll("tbody tr").length === 5'), "Segunda página não carregou");
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await ate(() => cdp.avaliar<boolean>('!document.querySelector("[role=dialog]")'), "Escape não fecha");
      assert.equal(await cdp.avaliar('document.activeElement.textContent'), "Ver relatório IA");
      await cdp.avaliar('document.querySelector("[aria-label*=Configurar]").focus(); document.querySelector("[aria-label*=Configurar]").click()');
      await ate(() => cdp.avaliar<boolean>('!!document.querySelector("textarea")'), "Configuração não abriu");
      await cdp.avaliar('const e = document.querySelector("textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"Sedinha = Fourway. Regra específica do app."); e.dispatchEvent(new Event("input", {bubbles:true}))');
      await click("Salvar configuração"); await ate(() => contem("Falha temporária ao salvar."), "Erro não apareceu");
      assert.equal(await cdp.avaliar('document.querySelector("textarea").value'), "Sedinha = Fourway. Regra específica do app.");
      await click("Salvar configuração"); await ate(() => contem("Configuração salva"), "Configuração não salvou");
      assert.equal(await cdp.avaliar('document.documentElement.scrollWidth <= innerWidth'), true);
      await cdp.avaliar('[...document.querySelectorAll("[role=dialog] button")].at(-1).focus()');
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
      assert.equal(await cdp.avaliar('document.activeElement.getAttribute("aria-label")'), "Fechar diálogo IA");
    });
  }
  await cdp.pedir("Page.navigate", { url: `${pathToFileURL(path.join(pasta, "index.html")).href}?leitura=1` });
  await ate(() => contem("Resultados salvos"), "Tela de leitura não carregou");
  assert.equal(await cdp.avaliar('!!document.querySelector("[aria-label*=Configurar]")'), false);
  assert.equal(await contem("Gerar relatório IA"), false);
});
