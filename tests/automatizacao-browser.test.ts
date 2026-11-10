import assert from "node:assert/strict";
import { test } from "node:test";
import { configurarBrowserWorker, promptBrowserWorker, respostaBrowserSchema } from "@/lib/automatizacao/browser-worker";

const env = { NODE_ENV: "test", HOME: "/home/operador", PATH: "/usr/bin",
  AUTOMATIZACAO_BROWSER_ENABLED: "true", AUTOMATIZACAO_BROWSER_MCP_CLI: "/opt/mcp/cli.js",
  AUTOMATIZACAO_BROWSER_PROFILE: "/home/operador/browser", } as const;

test("browser opt-in configura MCP persistente sem expor secrets", () => {
  assert.equal(configurarBrowserWorker({ NODE_ENV: "test" }), null);
  const config = configurarBrowserWorker({ ...env, AUTOMATIZACAO_WORKER_TOKEN: "segredo", OPENAI_API_KEY: "segredo" })!;
  const argumentos = config.argsCodex.join(" ");
  assert.match(argumentos, /--user-data-dir/);
  assert.match(argumentos, /--headless/);
  assert.match(argumentos, /browser_evaluate/);
  assert.match(argumentos, /required=true/);
  assert.ok(config.argsCodex.includes('mcp_servers.browser.default_tools_approval_mode="approve"'));
  const permitidas = config.argsCodex.find((v) => v.startsWith("mcp_servers.browser.enabled_tools="))!;
  assert.match(permitidas, /browser_navigate/);
  assert.match(permitidas, /browser_click/);
  assert.doesNotMatch(permitidas, /browser_evaluate|browser_run_code|browser_file_upload|browser_install/);
  assert.doesNotMatch(argumentos, /segredo|no-sandbox|unrestricted/);
});

test("browser visível exige sessão gráfica; caminhos relativos são rejeitados", () => {
  assert.throws(() => configurarBrowserWorker({ ...env, AUTOMATIZACAO_BROWSER_PROFILE: "relativo" }));
  assert.throws(() => configurarBrowserWorker({ ...env, AUTOMATIZACAO_BROWSER_HEADLESS: "false" }), /DISPLAY/);
  const config = configurarBrowserWorker({ ...env, AUTOMATIZACAO_BROWSER_HEADLESS: "false", DISPLAY: ":0", XAUTHORITY: "/home/operador/.Xauthority" })!;
  assert.doesNotMatch(config.argsCodex.join(" "), /--headless/);
  assert.match(config.argsCodex.join(" "), /DISPLAY/);
});

test("resultado de browser exige confirmação explícita e preserva pendências", () => {
  assert.equal(respostaBrowserSchema.safeParse({ resultado: "feito" }).success, false);
  assert.equal(respostaBrowserSchema.parse({ concluida: false, resultado: "Login necessário" }).concluida, false);
  assert.match(promptBrowserWorker("# Minha habilidade"), /# Minha habilidade/);
  assert.match(promptBrowserWorker("prompt"), /Não repita submissões/);
});
