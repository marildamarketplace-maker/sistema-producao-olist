import assert from "node:assert/strict";
import { test } from "node:test";
import { configurarBrowserWorker, configurarServicoBrowser, promptBrowserWorker, respostaBrowserSchema } from "@/lib/automatizacao/browser-worker";

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
  assert.doesNotMatch(permitidas, /browser_close|browser_evaluate|browser_run_code|browser_file_upload|browser_install/);
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
  assert.match(promptBrowserWorker("prompt"), /Liste as abas/);
  assert.match(promptBrowserWorker("prompt"), /Não use browser_close/);
  assert.match(promptBrowserWorker("prompt"), /Mantenha a aba do ERP aberta/);
  assert.match(promptBrowserWorker("prompt"), /não use dados antigos/);
  assert.match(promptBrowserWorker("prompt"), /execução parcial/);
});

test("avaliações não dependem do ERP e consulta de estoque fica restrita às habilidades que a exigem", () => {
  const habilidade = "# responder-avaliacoes-marketplaces\nResponda avaliações pendentes na Shopee e no TikTok Shop.";
  const prompt = promptBrowserWorker(habilidade);
  assert.ok(prompt.endsWith(habilidade));
  assert.match(prompt, /Consulte o ERP Meuryshop[^\n]+somente quando a habilidade exigir dados dele/);
  assert.match(prompt, /Somente nas habilidades que exigem estoque ou prioridades do ERP/);
  assert.match(prompt, /Responder avaliações não depende de estoque nem de consulta ao ERP/);
  assert.match(prompt, /Não bloqueie respostas\na avaliações por indisponibilidade, login ou ausência de dados no ERP/);
  assert.doesNotMatch(prompt, /Após o login, recarregue o dashboard e confira SKUs, saldos e prioridades atuais antes de agir/);
});

test("impulsionamento encerra normalmente por vagas esgotadas sem ocultar envios incertos", () => {
  const prompt = promptBrowserWorker("# shopee-impulsionar-produtos\nImpulsionar até quatro anúncios conforme vagas disponíveis.");
  assert.match(prompt, /vagas esgotadas confirmadas na interface são um\nencerramento normal: retorne concluida=true/);
  assert.match(prompt, /todos os impulsionamentos realizados estejam verificados e não haja envio incerto/);
  assert.match(prompt, /Uma tarefa com pendências obrigatórias deve retornar concluida=false/);
  assert.match(prompt, /Se faltar login, MFA, CAPTCHA,[\s\S]*retorne concluida=false/);
});

test("MCP persistente usa só transporte local e não exige display do cliente", () => {
  const config = configurarBrowserWorker({ NODE_ENV: "test", AUTOMATIZACAO_BROWSER_ENABLED: "true",
    AUTOMATIZACAO_BROWSER_HEADLESS: "false", AUTOMATIZACAO_BROWSER_MCP_URL: "http://127.0.0.1:8931/mcp" })!;
  assert.equal(config.cli, undefined);
  assert.equal(config.perfil, undefined);
  assert.ok(config.argsCodex.includes('mcp_servers.browser.url="http://127.0.0.1:8931/mcp"'));
  assert.doesNotMatch(config.argsCodex.join(" "), /browser.command|browser.args|browser.env/);
  for (const url of ["http://0.0.0.0:8931/mcp", "https://externo.test/mcp", "http://127.0.0.1:8931/", "http://user:senha@127.0.0.1:8931/mcp", "http://127.0.0.1:8931/mcp?token=segredo"]) {
    assert.throws(() => configurarBrowserWorker({ ...env, AUTOMATIZACAO_BROWSER_MCP_URL: url }));
  }
});

test("serviço mantém contexto aberto sem encaminhar secrets do worker", () => {
  const config = configurarServicoBrowser({ ...env, DISPLAY: ":0", AUTOMATIZACAO_BROWSER_HEADLESS: "false",
    AUTOMATIZACAO_BROWSER_MCP_URL: "http://127.0.0.1:8931/mcp", AUTOMATIZACAO_WORKER_TOKEN: "segredo",
    CODEX_API_KEY: "segredo", DATABASE_URL: "segredo" });
  assert.ok(config.args.includes("--shared-browser-context"));
  assert.ok(config.args.includes("--cdp-endpoint"));
  assert.ok(!config.args.includes("--user-data-dir"));
  assert.ok(config.browserArgs.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(config.browserArgs.includes("--remote-debugging-port=9222"));
  assert.ok(config.browserArgs.includes(`--user-data-dir=${env.AUTOMATIZACAO_BROWSER_PROFILE}`));
  assert.deepEqual(config.args.slice(config.args.indexOf("--idle-timeout"), config.args.indexOf("--idle-timeout") + 2), ["--idle-timeout", "0"]);
  assert.deepEqual(config.args.slice(config.args.indexOf("--host"), config.args.indexOf("--host") + 2), ["--host", "127.0.0.1"]);
  assert.doesNotMatch(JSON.stringify(config.env), /segredo/);
  assert.doesNotMatch(config.args.join(" "), /--headless|--no-sandbox/);
  assert.doesNotMatch(config.browserArgs.join(" "), /--headless|--no-sandbox/);
  assert.equal(config.env.DISPLAY, ":0");
});


test("bloqueio é explícito e incompatível com conclusão", () => {
  assert.equal(respostaBrowserSchema.parse({ concluida: false, bloqueada: true, resultado: "CAPTCHA na Shopee; TikTok concluído." }).bloqueada, true);
  assert.equal(respostaBrowserSchema.safeParse({ concluida: true, bloqueada: true, resultado: "contraditório" }).success, false);
  assert.equal(respostaBrowserSchema.parse({ concluida: false, resultado: "erro técnico" }).bloqueada, false);
  assert.match(promptBrowserWorker("habilidade"), /bloqueada=true e concluida=false/);
});

 test("evidência usa destino explícito por execução sem alterar o escopo da habilidade", () => {
   const prompt = promptBrowserWorker("# Escopo", "/privado/artefatos/tentativa.png");
   assert.match(prompt, /filename de browser_take_screenshot/);
   assert.ok(prompt.includes(JSON.stringify("/privado/artefatos/tentativa.png")));
   assert.ok(prompt.endsWith("# Escopo"));
   assert.match(prompt, /evidencia=null/);
 });
