import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as aguardar } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

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

test("Fila: cancelamento com confirmação, recuperação de erro e foco", { skip: chrome ? false : "Chrome/Chromium não está instalado; configure OLIST_SYNC_TEST_CHROME_PATH", timeout: 45_000 }, async t => {
  const pasta = await mkdtemp(path.join(tmpdir(), "fila-cancelamento-ui-test-"));
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
    entryPoints: [path.join(raiz, "tests/fixtures/fila-cancelamento-browser.tsx")], outfile: path.join(pasta, "app.js"),
    bundle: true, platform: "browser", jsx: "automatic", tsconfig: path.join(raiz, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },

  });
  const css = await postcss([tailwindcss({ content: [path.join(raiz, "src/components/fila-pedidos-fornecedor-client.tsx")], darkMode: "class" })]).process(await readFile(path.join(raiz, "src/app/globals.css"), "utf8"), { from: path.join(raiz, "src/app/globals.css") });
  await writeFile(path.join(pasta, "app.css"), css.css);
  await writeFile(path.join(pasta, "index.html"), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Teste local Olist</title><link rel="stylesheet" href="./app.css"><body><div id="root"></div><script src="./app.js"></script></body></html>');
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
  for (const largura of [390, 1280]) {
    await t.test(`cancelar sem filial, teclado, falha e confirmação em ${largura}px`, async () => {
      await cdp.pedir("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 600 });
      await cdp.pedir("Page.navigate", { url: `${pathToFileURL(path.join(pasta, "index.html")).href}?viewport=${largura}` });
      await ate(() => cdp.avaliar<boolean>('[...document.querySelectorAll("button")].some(b=>b.textContent === "Mais opções")'), "Fila não carregou");
      for (const tema of ["", "dark"]) {
        await cdp.avaliar(`document.documentElement.className=${JSON.stringify(tema)}`);
        assert.equal(await cdp.avaliar<boolean>('document.documentElement.scrollWidth<=innerWidth'), true, "Overflow da página");
      }
      const clicar = async (texto: string) => cdp.avaliar(`[...document.querySelectorAll("button")].find(b=>b.textContent===${JSON.stringify(texto)}).click()`);
      await clicar("Mais opções");
      assert.equal(await cdp.avaliar<boolean>('[...document.querySelectorAll("button")].find(b=>b.textContent==="Enviar para a Olist").disabled'), true);
      await clicar("Cancelar pedido");
      await ate(() => cdp.avaliar<boolean>('!!document.querySelector("dialog[open]")'), "Confirmação não abriu");
      assert.equal(await cdp.avaliar<string>('document.activeElement.textContent'), "Voltar");
      assert.match(await cdp.avaliar<string>('document.querySelector("dialog").textContent'), /não cancela pedidos na Olist/);
      assert.equal(await cdp.avaliar<boolean>('document.querySelector("dialog").scrollWidth<=document.querySelector("dialog").clientWidth'), true);
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8 });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 8 });
      assert.equal(await cdp.avaliar<string>('document.activeElement.textContent'), "Confirmar cancelamento");
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await cdp.pedir("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
      await ate(() => cdp.avaliar<boolean>('!document.querySelector("dialog[open]")'), "Escape não fechou");
      assert.equal(await cdp.avaliar<string>('document.activeElement.textContent'), "Mais opções");
      await clicar("Mais opções"); await clicar("Cancelar pedido");
      await cdp.avaliar('window.filaCancelamentoTeste.falhar=true');
      await clicar("Confirmar cancelamento");
      await ate(() => cdp.avaliar<boolean>('document.querySelector("dialog [role=alert]")?.textContent.includes("Pedido alterado")??false'), "Erro não apareceu");
      assert.equal(await cdp.avaliar<boolean>('!!document.querySelector("dialog[open]")'), true);
      await cdp.avaliar('window.filaCancelamentoTeste.falhar=false');
      await clicar("Confirmar cancelamento");
      await ate(() => cdp.avaliar<boolean>('!document.querySelector("dialog[open]")&&document.body.textContent.includes("Pedido cancelado na fila")'), "Sucesso não atualizou fila");
      assert.equal(await cdp.avaliar<number>('window.filaCancelamentoTeste.chamadas.length'), 2);
      assert.equal(await cdp.avaliar<string>('document.querySelector("article button[aria-expanded]").disabled.toString()'), "true");
      assert.equal(await cdp.avaliar<string>('document.activeElement.getAttribute("role")'), "status");
    });
  }
});
