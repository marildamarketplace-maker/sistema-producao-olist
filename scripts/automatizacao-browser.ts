import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { configurarServicoBrowser } from "@/lib/automatizacao/browser-worker";

async function portaLivre(porta: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(porta, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

async function main() {
  const config = configurarServicoBrowser();
  await access(config.cli);
  await mkdir(config.perfil, { recursive: true, mode: 0o700 });
  await mkdir(config.artefatos, { recursive: true, mode: 0o700 });
  // Reutiliza a instalação versionada ao lado do MCP, sem instalar no ERP.
  const { chromium } = createRequire(config.cli)("playwright") as { chromium: { executablePath(): string } };
  const executable = chromium.executablePath();
  await access(executable);
  // Nunca se conecta silenciosamente a outro perfil que já ocupe essas portas.
  await portaLivre(9222);
  await portaLivre(8931);
  const options = { cwd: dirname(config.perfil), shell: false, env: config.env, stdio: "ignore" as const };
  const browser = spawn(executable, config.browserArgs, options);
  let mcp: ChildProcess | undefined;
  let encerrando = false;
  const terminar = (falha = false) => {
    if (encerrando) return;
    encerrando = true;
    mcp?.kill("SIGTERM");
    browser.kill("SIGTERM");
    if (falha) {
      console.error("Serviço do navegador encerrou. Confira portas, instalação, perfil e sessão gráfica.");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => terminar());
  process.once("SIGINT", () => terminar());
  browser.once("error", () => terminar(true));
  browser.once("exit", () => { if (!encerrando) terminar(true); });
  try {
    let pronto = false;
    for (let tentativa = 0; tentativa < 100 && !encerrando; tentativa++) {
      pronto = await fetch(`${config.cdpUrl}/json/version`, { signal: AbortSignal.timeout(500), redirect: "error" })
        .then((r) => r.ok).catch(() => false);
      if (pronto) break;
      await esperar(100);
    }
    if (!pronto || encerrando) throw new Error("BROWSER_INDISPONIVEL");
    mcp = spawn(process.execPath, config.args, options);
    mcp.once("error", () => terminar(true));
    mcp.once("exit", () => { if (!encerrando) terminar(true); });
    mcp.once("spawn", () => console.info("Chromium independente aberto. MCP iniciado em 127.0.0.1:8931; valide a conexão pelo worker."));
  } catch {
    terminar(true);
  }
}

main().catch(() => {
  console.error("Revise a instalação do Playwright, portas 8931/9222, perfil e DISPLAY/XAUTHORITY.");
  process.exitCode = 1;
});
