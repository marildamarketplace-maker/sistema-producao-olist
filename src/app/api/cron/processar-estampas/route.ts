import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function inteiroEnv(nome: string, padrao: number, maximo: number) {
  const valor = process.env[nome]?.trim();
  const numero = valor ? Number(valor) : padrao;
  if (!Number.isSafeInteger(numero) || numero <= 0 || numero > maximo) {
    throw new Error(`${nome} deve ser inteiro entre 1 e ${maximo}.`);
  }
  return numero;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const inicio = Date.now();
  try {
    if ((process.env.IMAGE_ANALYSIS_PROVIDER?.trim().toLowerCase() || "openai") !== "openai") {
      throw new Error("O cron de estampas exige IMAGE_ANALYSIS_PROVIDER=openai.");
    }
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY não configurada.");
    const timeoutIa = inteiroEnv("OPENAI_IMAGE_ANALYSIS_TIMEOUT_MS", 60_000, 120_000);
    const timeoutPreview = inteiroEnv("ESTAMPA_PREVIEW_TIMEOUT_MS", 15_000, 60_000);
    const tentativas = inteiroEnv("AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS", 1, 3);
    const reservaJobMs = timeoutPreview + (tentativas + 1) * timeoutIa + 20_000;
    if (reservaJobMs >= 280_000) throw new Error("Timeouts de análise excedem o orçamento do cron.");
    const concorrencia = inteiroEnv("ESTAMPA_WORKER_CONCURRENCY", 2, 8);
    const maxJobs = inteiroEnv("ESTAMPA_CRON_MAX_JOBS", 50, 200);
    const lockTimeoutMs = inteiroEnv("ESTAMPA_WORKER_LOCK_TIMEOUT_MS", 900_000, 3_600_000);
    if (lockTimeoutMs < 300_000) throw new Error("Lock do cron deve durar pelo menos 300000 ms.");
    const workerId = `vercel-cron-${randomUUID()}`;
    // Importa acesso ao banco somente após autenticação e validação.
    const { executarEstampasCron } = await import("@/services/estampasCronService");
    const { detectarEstampasPendentes } = await import("@/services/detectarEstampasPendentesService");
    const { assumirProximoJobAiAnalysis, recuperarJobsAiAnalysisAbandonados } = await import("@/repositories/estampa-jobs-repository");
    const { processarJob } = await import("@/workers/estampas-worker");
    const { processarAnaliseIaEstampa } = await import("@/services/processarAnaliseIaEstampaService");
    const resultado = await executarEstampasCron({ prazoMs: inicio + 280_000, reservaJobMs, maxJobs, concorrencia }, {
      detectar: deveContinuar => detectarEstampasPendentes({ deveContinuar }),
      recuperar: () => recuperarJobsAiAnalysisAbandonados(lockTimeoutMs),
      assumir: () => assumirProximoJobAiAnalysis(workerId),
      processar: job => processarJob(job, { workerId, lockTimeoutMs, processar: processarAnaliseIaEstampa }),
    });
    console.info("[estampas-cron] Execução concluída.", { workerId, ...resultado });
    return NextResponse.json({ ok: resultado.falhas === 0 && resultado.locksPerdidos === 0, ...resultado });
  } catch (error) {
    // Evita expor erros de provedores, credenciais ou conexão na resposta HTTP.
    console.error("[estampas-cron] Falha na execução.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      duracaoMs: Date.now() - inicio,
    });
    return NextResponse.json({ error: "Falha no processamento de estampas." }, { status: 500 });
  }
}
