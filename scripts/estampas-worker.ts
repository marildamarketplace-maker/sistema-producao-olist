import "dotenv/config";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { prisma } from "@/lib/prisma";
import {
  processarAnaliseIaEstampa,
  processarAnaliseIaEstampaStub,
} from "@/services/processarAnaliseIaEstampaService";
import { executarEstampasWorker } from "@/workers/estampas-worker";

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

  const controller = new AbortController();
  const encerrar = () => controller.abort();
  process.once("SIGINT", encerrar);
  process.once("SIGTERM", encerrar);

  await executarEstampasWorker({
    workerId: process.env.ESTAMPA_WORKER_ID?.trim() || `${hostname()}-${process.pid}-${randomUUID()}`,
    concorrencia: inteiroEnv("ESTAMPA_WORKER_CONCURRENCY", 2, 8),
    intervaloPollingMs: inteiroEnv("ESTAMPA_WORKER_POLL_MS", 5_000),
    lockTimeoutMs: inteiroEnv("ESTAMPA_WORKER_LOCK_TIMEOUT_MS", 15 * 60_000),
    detectorIntervalMs: inteiroEnv("ESTAMPA_DETECTOR_INTERVAL_MS", 60_000),
    processar: mode === "live" ? processarAnaliseIaEstampa : processarAnaliseIaEstampaStub,
    signal: controller.signal,
  });
}

main()
  .catch((error) => {
    console.error("[estampas-worker] Falha fatal.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
