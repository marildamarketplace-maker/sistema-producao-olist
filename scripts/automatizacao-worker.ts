import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { renovarEnquantoValida } from "@/lib/automatizacao/renovacao";
import { z } from "zod";
import { ambienteCodexCli, executarCodexCli } from "@/services/image-analysis/executarCodexCli";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const respostaSchema = z.object({ resultado: z.string().trim().min(1).max(8_000).refine((texto) => !texto.includes("\0")) });
const reservaSchema = z.object({ trabalho: z.object({ reserva: z.uuid(), markdown: z.string() }).nullable() });
const parar = new AbortController();
process.once("SIGTERM", () => parar.abort());
process.once("SIGINT", () => parar.abort());

async function main() {
  const destino = new URL("/api/interno/automatizacao", process.env.AUTOMATIZACAO_ERP_URL);
  const token = process.env.AUTOMATIZACAO_WORKER_TOKEN;
  const chave = process.env.CODEX_API_KEY;
  const versao = process.env.AUTOMATIZACAO_CODEX_VERSION;
  const executable = process.env.CODEX_CLI_PATH || "codex";
  if (destino.protocol !== "https:" || !token || !chave || !versao) throw new Error("CONFIGURACAO");
  const { stdout } = await executarCodexCli({ executable, args: ["--version"], cwd: tmpdir(), timeoutMs: 10_000 });
  if (stdout.trim().split(/\s+/).at(-1) !== versao) throw new Error("VERSAO_CODEX");

  async function api(corpo: { acao: string; [campo: string]: unknown }, timeoutMs = 10_000) {
    const resposta = await fetch(destino, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    });
    if (resposta.status === 409 || (corpo.acao === "renovar" && [401, 403].includes(resposta.status))) return null;
    if (!resposta.ok) throw new Error("API");
    return resposta.json() as Promise<unknown>;
  }

  while (!parar.signal.aborted) {
    try {
      const inicioReserva = performance.now();
      const { trabalho } = reservaSchema.parse(await api({ acao: "reservar" }));
      if (!trabalho) {
        await esperar(5_000, undefined, { signal: parar.signal });
        continue;
      }
      const { reserva, markdown } = trabalho;
      const fim = new AbortController();
      const cwd = await mkdtemp(join(tmpdir(), "erp-automatizacao-"));
      const renovacao = renovarEnquantoValida({
        iniciadaEm: inicioReserva,
        renovar: async (timeoutMs) => Boolean(await api({ acao: "renovar", reserva }, timeoutMs)),
        esperar: (ms) => esperar(ms, undefined, { signal: fim.signal }).catch(() => {}),
        agora: () => performance.now(),
        signal: fim.signal,
      }).then((valida) => { if (!valida) fim.abort(); });
      const iniciado = Date.now();
      let desfecho = "SUCESSO";
      let resultado: string;
      try {
        const schemaPath = join(cwd, "resposta.json");
        await writeFile(schemaPath, JSON.stringify({ type: "object", properties: { resultado: { type: "string" } }, required: ["resultado"], additionalProperties: false }), { mode: 0o600 });
        const saidaPath = join(cwd, "resultado.json");
        await executarCodexCli({
          executable, cwd, timeoutMs: 300_000, signal: fim.signal,
          env: { ...ambienteCodexCli({ NODE_ENV: "production", PATH: process.env.PATH }), HOME: cwd, CODEX_HOME: cwd, CODEX_API_KEY: chave },
          args: [
            "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
            "--color", "never", "--output-schema", schemaPath, "--output-last-message", saidaPath,
            "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
            ...["shell_tool", "unified_exec", "apps", "plugins", "memories", "multi_agent", "image_generation"]
              .flatMap((feature) => ["-c", `features.${feature}=false`]),
            "-",
          ],
          stdin: markdown,
        });
        resultado = respostaSchema.parse(JSON.parse(await readFile(saidaPath, "utf8"))).resultado;
      } catch (error) {
        const codigo = error instanceof ImageAnalysisProviderError ? error.code : "SAIDA_INVALIDA";
        desfecho = ["AUTHENTICATION_ERROR", "CONFIGURATION_ERROR"].includes(codigo) ? "INDISPONIVEL"
          : error instanceof ImageAnalysisProviderError && error.retriable ? "TEMPORARIA" : "FALHA";
        resultado = codigo;
      } finally {
        await rm(cwd, { force: true, recursive: true }).catch(() => console.error("Falha ao limpar o diretório da execução."));
      }
      try {
        if (!fim.signal.aborted) {
          const fechamento = { acao: "finalizar", reserva, desfecho, resultado };
          const resposta = await api(fechamento).catch(() => api(fechamento));
          if (resposta) console.info(JSON.stringify({ tipo: "EXECUTAR_PROMPT", desfecho, duracaoMs: Date.now() - iniciado }));
        }
      } finally {
        fim.abort();
        await renovacao;
      }
      if (desfecho === "INDISPONIVEL") {
        console.error("Executor Codex indisponível.");
        await esperar(60_000, undefined, { signal: parar.signal });
      }
    } catch {
      if (!parar.signal.aborted) {
        console.error("Falha de comunicação com a fila.");
        await esperar(10_000, undefined, { signal: parar.signal }).catch(() => {});
      }
    }
  }
}

main().catch(() => {
  console.error("Revise a configuração do worker e a versão instalada do Codex.");
  process.exitCode = 1;
});
