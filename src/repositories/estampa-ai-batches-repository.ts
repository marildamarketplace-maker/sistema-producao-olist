import { Prisma, StatusEstampaAiBatch, StatusJobEstampa } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { criarCustomIdBatchEstampa } from "@/services/image-analysis/criarRequisicaoBatchAnaliseEstampa";

export type ItemPreparadoBatchEstampa = {
  jobId: string;
  estampaId: string;
  previewUrl: string;
  contentHash: string;
  customId: string;
};

type CandidatoBatch = {
  jobId: string;
  estampaId: bigint;
  previewUrl: string;
  contentHash: string;
};

export async function prepararBatchEstampas(limite: number, workerId: string) {
  if (!Number.isInteger(limite) || limite < 1 || limite > 5_000) {
    throw new Error("Limite do batch deve estar entre 1 e 5000.");
  }
  if (!workerId.trim()) throw new Error("workerId é obrigatório.");

  return prisma.$transaction(async (tx) => {
    const batch = await tx.estampaAiBatch.create({ data: { status: StatusEstampaAiBatch.PREPARING } });
    const candidatos = await tx.$queryRaw<CandidatoBatch[]>(Prisma.sql`
      SELECT
        job.id AS "jobId",
        job.estampa_id AS "estampaId",
        estampa.preview_url AS "previewUrl",
        estampa.content_hash AS "contentHash"
      FROM estampa_jobs job
      INNER JOIN estampas estampa ON estampa.id = job.estampa_id
      WHERE job.tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
        AND job.status = 'PENDING'::"StatusJobEstampa"
        AND job.next_attempt_at <= CURRENT_TIMESTAMP
        AND job.batch_id IS NULL
        AND estampa.preview_url IS NOT NULL
        AND btrim(estampa.preview_url) <> ''
        AND estampa.content_hash IS NOT NULL
        AND btrim(estampa.content_hash) <> ''
        AND (job.manual_requested OR estampa.ai_processed_hash IS DISTINCT FROM estampa.content_hash)
      ORDER BY job.created_at, job.id
      FOR UPDATE OF job SKIP LOCKED
      LIMIT ${limite}
    `);

    if (candidatos.length === 0) {
      await tx.estampaAiBatch.delete({ where: { id: batch.id } });
      return null;
    }

    const itens: ItemPreparadoBatchEstampa[] = candidatos.map((item) => ({
      jobId: item.jobId,
      estampaId: item.estampaId.toString(),
      previewUrl: item.previewUrl,
      contentHash: item.contentHash,
      customId: criarCustomIdBatchEstampa({
        estampaId: item.estampaId.toString(),
        contentHash: item.contentHash,
      }),
    }));

    for (const item of itens) {
      await tx.estampaJob.update({
        where: { id: item.jobId },
        data: {
          status: StatusJobEstampa.PROCESSING,
          batchId: batch.id,
          providerCustomId: item.customId,
          workerId,
          lockedAt: new Date(),
          startedAt: new Date(),
          tentativas: { increment: 1 },
        },
      });
    }
    await tx.estampaAiBatch.update({
      where: { id: batch.id },
      data: { quantidadeJobs: itens.length },
    });
    return { batchId: batch.id, itens };
  });
}

export async function confirmarEnvioBatchEstampas(input: {
  batchId: string;
  providerBatchId: string;
  inputFileId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.estampaAiBatch.update({
      where: { id: input.batchId },
      data: {
        providerBatchId: input.providerBatchId,
        inputFileId: input.inputFileId,
        status: StatusEstampaAiBatch.SUBMITTED,
        submittedAt: new Date(),
        lastCheckedAt: new Date(),
      },
    });
    await tx.estampaJob.updateMany({
      where: { batchId: input.batchId, status: StatusJobEstampa.PROCESSING },
      data: {
        status: StatusJobEstampa.WAITING_PROVIDER,
        workerId: null,
        lockedAt: null,
      },
    });
  });
}

export async function desfazerPreparacaoBatchEstampas(batchId: string, erro: string) {
  return prisma.$transaction(async (tx) => {
    await tx.estampaJob.updateMany({
      where: { batchId, status: StatusJobEstampa.PROCESSING },
      data: {
        status: StatusJobEstampa.PENDING,
        batchId: null,
        providerCustomId: null,
        workerId: null,
        lockedAt: null,
        startedAt: null,
        tentativas: { decrement: 1 },
        ultimoErro: erro.slice(0, 2_000),
      },
    });
    await tx.estampaAiBatch.update({
      where: { id: batchId },
      data: {
        status: StatusEstampaAiBatch.FAILED,
        ultimoErro: erro.slice(0, 2_000),
        failedAt: new Date(),
      },
    });
  });
}

export async function listarBatchesAguardandoProvider(limite = 20) {
  return prisma.estampaAiBatch.findMany({
    where: { status: { in: [StatusEstampaAiBatch.SUBMITTED, StatusEstampaAiBatch.IN_PROGRESS] } },
    orderBy: { lastCheckedAt: "asc" },
    take: limite,
  });
}

export async function atualizarEstadoProviderBatch(input: {
  batchId: string;
  status: StatusEstampaAiBatch;
  outputFileId?: string | null;
  errorFileId?: string | null;
  concluidos?: number;
  falhas?: number;
  erro?: string | null;
}) {
  return prisma.estampaAiBatch.update({
    where: { id: input.batchId },
    data: {
      status: input.status,
      outputFileId: input.outputFileId,
      errorFileId: input.errorFileId,
      quantidadeConcluidos: input.concluidos,
      quantidadeFalhas: input.falhas,
      ultimoErro: input.erro?.slice(0, 2_000),
      lastCheckedAt: new Date(),
      completedAt: input.status === StatusEstampaAiBatch.COMPLETED ? new Date() : undefined,
      failedAt: input.status === StatusEstampaAiBatch.FAILED || input.status === StatusEstampaAiBatch.CANCELLED || input.status === StatusEstampaAiBatch.EXPIRED ? new Date() : undefined,
    },
  });
}

export async function buscarJobBatchPorCustomId(batchId: string, customId: string) {
  return prisma.estampaJob.findFirst({
    where: {
      batchId,
      providerCustomId: customId,
      status: StatusJobEstampa.WAITING_PROVIDER,
    },
  });
}

export async function concluirJobBatch(jobId: string, batchId: string, contentHash: string) {
  const resultado = await prisma.estampaJob.updateMany({
    where: { id: jobId, batchId, status: StatusJobEstampa.WAITING_PROVIDER },
    data: {
      status: StatusJobEstampa.COMPLETED,
      finishedAt: new Date(),
      ultimoErro: null,
      batchId: null,
      providerCustomId: null,
    },
  });
  if (resultado.count !== 1) throw new Error(`Job ${jobId} não estava aguardando este batch.`);
  return contentHash;
}

export async function falharJobBatch(jobId: string, batchId: string, erro: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.estampaJob.findFirst({
      where: { id: jobId, batchId, status: StatusJobEstampa.WAITING_PROVIDER },
    });
    if (!job) return null;
    const permiteRetry = job.tentativas < job.maxTentativas;
    const status = permiteRetry ? StatusJobEstampa.PENDING : StatusJobEstampa.FAILED;
    await tx.estampaJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: permiteRetry ? null : new Date(),
        nextAttemptAt: permiteRetry
          ? new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(0, job.tentativas - 1), 60 * 60_000))
          : job.nextAttemptAt,
        ultimoErro: erro.slice(0, 2_000),
        batchId: null,
        providerCustomId: null,
      },
    });
    await tx.estampaCatalogoIa.updateMany({
      where: { id: job.estampaId },
      data: {
        processingStatus: status,
        processingError: erro.slice(0, 2_000),
      },
    });
    return status;
  });
}
