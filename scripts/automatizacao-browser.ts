import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { configurarServicoBrowser } from "@/lib/automatizacao/browser-worker";

async function main() {
  const config = configurarServicoBrowser();
  await access(config.cli);
  await mkdir(config.perfil, { recursive: true, mode: 0o700 });
  await mkdir(config.artefatos, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, config.args, {
    cwd: dirname(config.perfil), shell: false,
    env: config.env,
    // A saída do MCP pode conter páginas e dados de clientes. Não vai ao journal.
    stdio: ["ignore", "ignore", "ignore"],
  });
  const terminar = () => child.kill("SIGTERM");
  process.once("SIGTERM", terminar);
  process.once("SIGINT", terminar);
  child.once("error", () => {
    console.error("Não foi possível iniciar o serviço do navegador.");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.removeListener("SIGTERM", terminar);
    process.removeListener("SIGINT", terminar);
    if (code && !signal) {
      console.error("Serviço do navegador encerrou. Confira instalação, perfil em uso e sessão gráfica.");
      process.exitCode = 1;
    }
  });
  // 'spawn' confirma o processo, não a prontidão do MCP nem o login.
  child.once("spawn", () => console.info("Processo do navegador iniciado em 127.0.0.1:8931. Valide a conexão pelo worker."));
}

main().catch(() => {
  console.error("Revise a instalação do Playwright, o perfil e DISPLAY/XAUTHORITY.");
  process.exitCode = 1;
});
