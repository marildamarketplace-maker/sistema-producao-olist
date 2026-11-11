import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { test } from "node:test";
import { configurarServicoBrowser } from "@/lib/automatizacao/browser-worker";

async function porta() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const numero = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return numero;
}

test("Chromium e abas sobrevivem ao último cliente MCP e à reconexão", {
  skip: !process.env.MEURY_BROWSER_TEST_CLI || !process.env.MEURY_BROWSER_TEST_CHROME,
  timeout: 45_000,
}, async (t) => {
  const pasta = await mkdtemp(join(tmpdir(), "meury-browser-integracao-"));
  const cdp = `http://127.0.0.1:${await porta()}`;
  const httpPort = await porta();
  const config = configurarServicoBrowser({ NODE_ENV: "test", HOME: pasta, PATH: process.env.PATH,
    AUTOMATIZACAO_BROWSER_MCP_CLI: process.env.MEURY_BROWSER_TEST_CLI,
    AUTOMATIZACAO_BROWSER_PROFILE: join(pasta, "perfil") });
  const browserArgs = config.browserArgs.map((v) => v.startsWith("--remote-debugging-port=")
    ? `--remote-debugging-port=${new URL(cdp).port}` : v);
  const browser = spawn(process.env.MEURY_BROWSER_TEST_CHROME!, browserArgs, { env: config.env, stdio: "ignore" });
  const processos = [browser];
  t.after(async () => {
    const parar = (child: ReturnType<typeof spawn> | undefined) => new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
    for (const processo of processos.reverse()) await parar(processo);
    await rm(pasta, { recursive: true, force: true });
  });
  async function aguardar(url: string) {
    for (let i = 0; i < 100; i++) {
      if (await fetch(url, { signal: AbortSignal.timeout(300) }).then(() => true).catch(() => false)) return;
      await esperar(100);
    }
    throw new Error("Serviço não iniciou");
  }
  await aguardar(`${cdp}/json/version`);
  const args = config.args.map((v, i, a) => a[i - 1] === "--cdp-endpoint" ? cdp
    : a[i - 1] === "--port" ? String(httpPort) : v);
  const mcp = spawn(process.execPath, args, { cwd: pasta, env: config.env, stdio: "ignore" });
  processos.push(mcp);
  const endpoint = `http://127.0.0.1:${httpPort}/mcp`;
  await aguardar(endpoint);
  let id = 0;
  async function cliente() {
    let sessao = "";
    const rpc = async (method: string, params: object, notification = false) => {
      const r = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
          ...(sessao ? { "Mcp-Session-Id": sessao, "MCP-Protocol-Version": "2024-11-05" } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++id }), method, params }),
      });
      sessao = r.headers.get("mcp-session-id") ?? sessao;
      assert.ok(r.ok, `MCP HTTP ${r.status}`);
      const texto = await r.text();
      if (notification) return;
      const data = texto.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? texto;
      const resposta = JSON.parse(data);
      assert.equal(resposta.error, undefined);
      assert.ok(!resposta.result?.isError);
      return resposta.result;
    };
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste-persistencia", version: "1" } });
    await rpc("notifications/initialized", {}, true);
    return { rpc, fechar: async () => {
      assert.ok(sessao);
      const r = await fetch(endpoint, { method: "DELETE", headers: { "Mcp-Session-Id": sessao } });
      assert.ok(r.ok);
    } };
  }
  const primeiro = await cliente();
  await primeiro.rpc("tools/call", { name: "browser_tabs", arguments: { action: "list" } });
  const paginas = async () => (await (await fetch(`${cdp}/json/list`)).json() as { id: string; type: string }[])
    .filter((v) => v.type === "page").map((v) => v.id).sort();
  const antes = await paginas();
  assert.ok(antes.length > 0);
  await primeiro.fechar();
  assert.deepEqual(await paginas(), antes);
  const segundo = await cliente();
  await segundo.rpc("tools/call", { name: "browser_tabs", arguments: { action: "list" } });
  await segundo.fechar();
  assert.deepEqual(await paginas(), antes);
  assert.equal(browser.exitCode, null);
});
