import "dotenv/config";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lerOpcoesEstampasWorker } from "@/config/imageAnalysisProvider";

function inteiroEnv(nome: string, fallback: number, maximo = Number.MAX_SAFE_INTEGER) {
  const valor = process.env[nome]?.trim();
  if (!valor) return fallback;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > maximo) {
    throw new Error(`${nome} deve ser um inteiro entre 1 e ${maximo}.`);
  }
  return numero;
}

async function main() {
  const options = lerOpcoesEstampasWorker(process.argv.slice(2));
  if (options.help) {
    console.info(`Uso: ESTAMPA_AI_PROCESSOR_MODE=live npm run worker:estampas -- --provider=openai|codex-local

--provider  Sobrescreve IMAGE_ANALYSIS_PROVIDER nesta execução (padrão: openai).
--help, -h  Exibe esta ajuda sem iniciar o worker.

codex-local exige Codex CLI atualizado e autenticado via codex login (conta ChatGPT).
Modelos: CODEX_CLI_PRIMARY_MODEL e CODEX_CLI_FALLBACK_MODEL.
Executável: CODEX_CLI_PATH (padrão: codex). Timeout: CODEX_CLI_TIMEOUT_MS (padrão: 180000).`);
    return;
  }
  // Aplica a opção antes de importar serviços/configuração e antes de acessar jobs.
  process.env.IMAGE_ANALYSIS_PROVIDER = options.provider;
  const mode = process.env.ESTAMPA_AI_PROCESSOR_MODE?.trim().toLowerCase();
  if (mode !== "live" && mode !== "stub") {
    throw new Error(
      "Defina ESTAMPA_AI_PROCESSOR_MODE=live para processar com IA ou stub para testar somente o worker.",
    );
  }
  if (
    mode === "stub" &&
    process.env.ESTAMPA_ALLOW_STUB_COMPLETION?.trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      "O modo stub marca hashes como processados. Use-o somente em banco isolado e defina ESTAMPA_ALLOW_STUB_COMPLETION=true explicitamente.",
    );
  }

  if (mode === "live") {
    const { criarImageAnalysisProvider } = await import("@/services/image-analysis/imageAnalysisProviderFactory");
    const { CodexLocalImageAnalysisProvider } = await import("@/services/image-analysis/CodexLocalImageAnalysisProvider");
    const primary = criarImageAnalysisProvider("primary");
    const fallback = criarImageAnalysisProvider("fallback");
    if (primary instanceof CodexLocalImageAnalysisProvider) await primary.verificarDisponibilidade();
    console.info("[estampas-worker] Provedor configurado.", {
      provider: options.provider,
      primaryModel: primary.model,
      fallbackModel: fallback.model,
    });
  }

  const { prisma } = await import("@/lib/prisma");
  try {
    const { processarAnaliseIaEstampa, processarAnaliseIaEstampaStub } = await import("@/services/processarAnaliseIaEstampaService");
    const { executarEstampasWorker } = await import("@/workers/estampas-worker");
    const controller = new AbortController();
    const encerrar = () => controller.abort();
    process.once("SIGINT", encerrar);
    process.once("SIGTERM", encerrar);

    await executarEstampasWorker({
      workerId: process.env.ESTAMPA_WORKER_ID?.trim() || `${hostname()}-${process.pid}-${randomUUID()}`,
      concorrencia: inteiroEnv("ESTAMPA_WORKER_CONCURRENCY", options.provider === "codex-local" ? 1 : 2, 8),
      intervaloPollingMs: inteiroEnv("ESTAMPA_WORKER_POLL_MS", 5_000),
      lockTimeoutMs: inteiroEnv("ESTAMPA_WORKER_LOCK_TIMEOUT_MS", 15 * 60_000),
      detectorIntervalMs: inteiroEnv("ESTAMPA_DETECTOR_INTERVAL_MS", 60_000),
      processar: mode === "live" ? processarAnaliseIaEstampa : processarAnaliseIaEstampaStub,
      signal: controller.signal,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[estampas-worker] Falha fatal.", error);
  process.exitCode = 1;
});
