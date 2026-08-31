import type { EstampaJob } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { buscarEstampaPorId } from "@/repositories/catalogo-estampas-repository";
import {
  assumirProximoJobAiAnalysis,
  concluirEstampaJob,
  concluirEstampaJobIgnorado,
  recuperarJobsAiAnalysisAbandonados,
  registrarFalhaEstampaJob,
  renovarLockEstampaJob,
} from "@/repositories/estampa-jobs-repository";
import { CarregarPreviewEstampaError } from "@/services/carregarPreviewEstampaService";
import type { ProcessadorAnaliseIaEstampa } from "@/services/processarAnaliseIaEstampaService";
import { calcularBackoffRetryMs } from "@/services/estrategiaRetryEstampa";
import { detectarEstampasPendentes } from "@/services/detectarEstampasPendentesService";
import {
  EstampaInvalidaParaAnaliseError,
  verificarNecessidadeAnaliseIa,
} from "@/services/verificarNecessidadeAnaliseIa";

export type OpcoesEstampasWorker = {
  workerId: string;
  concorrencia: number;
  intervaloPollingMs: number;
  lockTimeoutMs: number;
  detectorIntervalMs: number;
  processar: ProcessadorAnaliseIaEstampa;
  reprocessamentoManual?: (job: EstampaJob) => boolean;
  signal?: AbortSignal;
};

function validarInteiroPositivo(valor: number, campo: string) {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${campo} deve ser um inteiro maior que zero.`);
  }
  return valor;
}

function esperar(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timeout = setTimeout(finalizar, ms);
    function finalizar() {
      signal?.removeEventListener("abort", cancelar);
      resolve();
    }
    function cancelar() {
      clearTimeout(timeout);
      finalizar();
    }
    signal?.addEventListener("abort", cancelar, { once: true });
  });
}

function mensagemErro(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido no processamento do job.";
}

function erroPermiteRetry(error: unknown) {
  if (error instanceof EstampaInvalidaParaAnaliseError) return false;
  if (error instanceof CarregarPreviewEstampaError) return error.retriable;
  if (
    typeof error === "object" &&
    error !== null &&
    "retriable" in error &&
    typeof error.retriable === "boolean"
  ) {
    return error.retriable;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1002", "P1008", "P1017", "P2034"].includes(error.code);
  }
  return true;
}

function contextoErro(error: unknown, job: EstampaJob) {
  const detalhes: Record<string, unknown> = {
    message: mensagemErro(error),
    errorName: error instanceof Error ? error.name : typeof error,
    jobId: job.id,
    estampaId: job.estampaId.toString(),
    tentativa: job.tentativas,
    maxTentativas: job.maxTentativas,
  };
  if (typeof error === "object" && error !== null) {
    if ("code" in error && typeof error.code === "string") detalhes.code = error.code;
    if ("status" in error && typeof error.status === "number") detalhes.httpStatus = error.status;
    if ("provider" in error && typeof error.provider === "string") {
      detalhes.provider = error.provider;
    }
  }
  return JSON.stringify(detalhes);
}

async function processarJob(
  job: EstampaJob,
  options: Pick<
    OpcoesEstampasWorker,
    "workerId" | "lockTimeoutMs" | "processar" | "reprocessamentoManual"
  >,
) {
  const iniciadoEm = Date.now();
  console.info("[estampas-worker] Processamento do job iniciado.", {
    jobId: job.id,
    estampaId: job.estampaId.toString(),
    tentativa: job.tentativas,
    maxTentativas: job.maxTentativas,
    manual: job.manualRequested,
  });
  const heartbeat = setInterval(() => {
    void renovarLockEstampaJob(job.id, options.workerId).catch((error) => {
      console.error("[estampas-worker] Falha ao renovar lock do job.", {
        jobId: job.id,
        error: mensagemErro(error),
      });
    });
  }, Math.max(1_000, Math.floor(options.lockTimeoutMs / 3)));

  try {
    const estampa = await buscarEstampaPorId(job.estampaId);
    if (!estampa) {
      throw new EstampaInvalidaParaAnaliseError(`Estampa ${job.estampaId} não encontrada.`);
    }

    const verificacao = verificarNecessidadeAnaliseIa(estampa, {
      reprocessamentoManual:
        job.manualRequested || options.reprocessamentoManual?.(job) === true,
    });
    if (verificacao.acao === "IGNORAR_JA_PROCESSADA") {
      const concluido = await concluirEstampaJobIgnorado(
        job.id,
        options.workerId,
        job.estampaId,
        verificacao.contentHash,
      );
      console.info("[estampas-worker] Job ignorado: análise já corresponde ao conteúdo atual.", {
        jobId: job.id,
        estampaId: job.estampaId,
        contentHash: verificacao.contentHash,
        concluido,
      });
      return;
    }

    const resultado = await options.processar(estampa, job);
    if (resultado.aiProcessedHash !== verificacao.contentHash) {
      throw new Error("O processador retornou um hash diferente da versão enviada para análise.");
    }
    const concluido = await concluirEstampaJob(
      job.id,
      options.workerId,
      job.estampaId,
      resultado.aiProcessedHash,
    );
    if (!concluido) {
      console.warn("[estampas-worker] Job perdeu o lock antes da conclusão.", { jobId: job.id });
    } else {
      console.info("[estampas-worker] Job concluído com sucesso.", {
        jobId: job.id,
        estampaId: job.estampaId.toString(),
        duracaoMs: Date.now() - iniciadoEm,
      });
    }
  } catch (error) {
    const erro = contextoErro(error, job);
    const retriable = erroPermiteRetry(error);
    const status = await registrarFalhaEstampaJob(
      job,
      options.workerId,
      erro,
      retriable,
    );
    console.error("[estampas-worker] Falha ao processar job.", {
      jobId: job.id,
      estampaId: job.estampaId,
      status,
      error: erro,
      retryInMs:
        status === "PENDING" && retriable ? calcularBackoffRetryMs(job.tentativas) : null,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function executarEstampasWorker(options: OpcoesEstampasWorker) {
  const concorrencia = validarInteiroPositivo(options.concorrencia, "concorrencia");
  validarInteiroPositivo(options.intervaloPollingMs, "intervaloPollingMs");
  validarInteiroPositivo(options.lockTimeoutMs, "lockTimeoutMs");
  validarInteiroPositivo(options.detectorIntervalMs, "detectorIntervalMs");

  async function executarDetector() {
    try {
      await detectarEstampasPendentes();
    } catch (error) {
      console.error("[estampas-worker] Falha temporária ao detectar estampas pendentes.", {
        workerId: options.workerId,
        error: mensagemErro(error),
      });
    }
  }

  await executarDetector();
  const recuperacaoInicial = await recuperarJobsAiAnalysisAbandonados(options.lockTimeoutMs);
  console.info("[estampas-worker] Worker iniciado.", {
    workerId: options.workerId,
    concorrencia,
    lockTimeoutMs: options.lockTimeoutMs,
  });
  if (recuperacaoInicial.recuperados > 0) {
    console.warn("[estampas-worker] Jobs travados recuperados automaticamente.", {
      workerId: options.workerId,
      ...recuperacaoInicial,
    });
  }
  let proximaRecuperacao = Date.now() + Math.max(1_000, Math.floor(options.lockTimeoutMs / 2));
  let proximaDeteccao = Date.now() + options.detectorIntervalMs;

  while (!options.signal?.aborted) {
    if (Date.now() >= proximaDeteccao) {
      await executarDetector();
      proximaDeteccao = Date.now() + options.detectorIntervalMs;
    }
    if (Date.now() >= proximaRecuperacao) {
      const recuperacao = await recuperarJobsAiAnalysisAbandonados(options.lockTimeoutMs);
      if (recuperacao.recuperados > 0) {
        console.warn("[estampas-worker] Jobs travados recuperados automaticamente.", {
          workerId: options.workerId,
          ...recuperacao,
        });
      }
      proximaRecuperacao = Date.now() + Math.max(1_000, Math.floor(options.lockTimeoutMs / 2));
    }

    const resultadosClaim = await Promise.allSettled(
      Array.from({ length: concorrencia }, () =>
        assumirProximoJobAiAnalysis(options.workerId),
      ),
    );
    const jobs = resultadosClaim.flatMap((resultado) => {
      if (resultado.status === "fulfilled") {
        return resultado.value ? [resultado.value] : [];
      }
      console.error("[estampas-worker] Falha ao assumir um slot de job.", {
        workerId: options.workerId,
        error: mensagemErro(resultado.reason),
      });
      return [];
    });

    if (jobs.length === 0) {
      await esperar(options.intervaloPollingMs, options.signal);
      continue;
    }

    console.info("[estampas-worker] Jobs assumidos para processamento.", {
      workerId: options.workerId,
      quantidade: jobs.length,
      jobs: jobs.map((job) => ({
        jobId: job.id,
        estampaId: job.estampaId.toString(),
        tentativa: job.tentativas,
      })),
    });

    await Promise.all(jobs.map((job) => processarJob(job, options)));
  }

  console.info("[estampas-worker] Worker encerrado.", { workerId: options.workerId });
}
