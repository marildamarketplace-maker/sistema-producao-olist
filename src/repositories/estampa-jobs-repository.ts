import {
  Prisma,
  StatusJobEstampa,
  TipoJobEstampa,
  type EstampaJob,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarHashConteudo } from "@/services/controleVersaoAnaliseEstampa";
import {
  calcularBackoffRetryMs,
  ESTAMPA_RETRY_BASE_DELAY_MS,
  ESTAMPA_RETRY_MAX_DELAY_MS,
} from "@/services/estrategiaRetryEstampa";

export type CriarEstampaJobInput = {
  estampaId: string | bigint;
  tipo?: TipoJobEstampa;
  maxTentativas?: number;
  estrategiaAposFalha?: "RETRY" | "REPROCESS";
};

export class ReprocessamentoManualAtivoError extends Error {
  constructor(estampaId: string | bigint) {
    super(`A estampa ${estampaId} já possui um job AI_ANALYSIS ativo.`);
    this.name = "ReprocessamentoManualAtivoError";
  }
}

export type AtualizarEstampaJobInput = {
  status?: StatusJobEstampa;
  tentativas?: number;
  maxTentativas?: number;
  ultimoErro?: string | null;
  nextAttemptAt?: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lockedAt?: Date | null;
  workerId?: string | null;
};

export type EstampaJobPainelRow = {
  id: string;
  estampaId: bigint;
  status: StatusJobEstampa;
  tentativas: number;
  maxTentativas: number;
  ultimoErro: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  manualRequested: boolean;
  codigo: string;
  variante: string | null;
  previewUrl: string | null;
  processedAt: Date | null;
  aiMetadata: Prisma.JsonValue | null;
};

export type ListarEstampaJobsPainelInput = {
  status?: StatusJobEstampa;
  limite?: number;
  offset?: number;
};

function validarId(valor: string, campo: string) {
  const normalizado = valor.trim();
  if (!normalizado) throw new Error(`${campo} é obrigatório.`);
  return normalizado;
}

function validarEstampaId(valor: string | bigint, campo = "estampaId") {
  try {
    const id = typeof valor === "bigint" ? valor : BigInt(valor.trim());
    if (id <= BigInt(0)) throw new Error();
    return id;
  } catch {
    throw new Error(`${campo} deve ser um inteiro positivo.`);
  }
}

function validarInteiroPositivo(valor: number, campo: string) {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${campo} deve ser um número inteiro maior que zero.`);
  }
  return valor;
}

function validarTentativas(valor: number) {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error("tentativas deve ser um número inteiro maior ou igual a zero.");
  }
  return valor;
}

export async function criarEstampaJob(
  input: CriarEstampaJobInput,
): Promise<EstampaJob> {
  const estampaId = validarEstampaId(input.estampaId);
  const maxTentativas = validarInteiroPositivo(input.maxTentativas ?? 3, "maxTentativas");
  const tipo = input.tipo ?? TipoJobEstampa.AI_ANALYSIS;
  const permiteReabrirFalha = input.estrategiaAposFalha !== undefined;

  return prisma.$transaction(async (transaction) => {
    const alterados = await transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO estampa_jobs (estampa_id, tipo, max_tentativas)
      VALUES (${estampaId}, ${tipo}::"TipoJobEstampa", ${maxTentativas})
      ON CONFLICT (estampa_id, tipo) DO UPDATE
      SET status = 'PENDING'::"StatusJobEstampa",
          tentativas = 0,
          max_tentativas = EXCLUDED.max_tentativas,
          ultimo_erro = NULL,
          next_attempt_at = CURRENT_TIMESTAMP,
          manual_requested = FALSE,
          manual_requested_at = NULL,
          manual_requested_by = NULL,
          created_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          started_at = NULL,
          finished_at = NULL,
          locked_at = NULL,
          worker_id = NULL
      WHERE estampa_jobs.status = 'COMPLETED'::"StatusJobEstampa"
         OR (${permiteReabrirFalha} AND estampa_jobs.status = 'FAILED'::"StatusJobEstampa")
      RETURNING id
    `;

    const job = await transaction.estampaJob.findUnique({
      where: { estampaId_tipo: { estampaId, tipo } },
    });
    if (!job) throw new Error("Não foi possível criar ou localizar o job da estampa.");
    if (alterados.length === 0 && job.status === StatusJobEstampa.FAILED) {
      throw new Error(
        "O job da estampa falhou. Use uma estratégia explícita de retry ou reprocessamento.",
      );
    }
    return job;
  });
}

export async function criarJobReprocessamentoManual(
  estampaId: string | bigint,
  solicitadoPor?: string | null,
): Promise<EstampaJob> {
  const estampa = validarEstampaId(estampaId);
  const usuario = solicitadoPor?.trim() || null;

  return prisma.$transaction(async (transaction) => {
    const jobsReabertos = await transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO estampa_jobs (
        estampa_id,
        tipo,
        manual_requested,
        manual_requested_at,
        manual_requested_by
      )
      VALUES (
        ${estampa},
        'AI_ANALYSIS'::"TipoJobEstampa",
        TRUE,
        CURRENT_TIMESTAMP,
        ${usuario}::UUID
      )
      ON CONFLICT (estampa_id, tipo) DO UPDATE
      SET status = 'PENDING'::"StatusJobEstampa",
          tentativas = 0,
          ultimo_erro = NULL,
          next_attempt_at = CURRENT_TIMESTAMP,
          manual_requested = TRUE,
          manual_requested_at = CURRENT_TIMESTAMP,
          manual_requested_by = EXCLUDED.manual_requested_by,
          created_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          started_at = NULL,
          finished_at = NULL,
          locked_at = NULL,
          worker_id = NULL
      WHERE estampa_jobs.status NOT IN (
        'PENDING'::"StatusJobEstampa",
        'PROCESSING'::"StatusJobEstampa"
      )
      RETURNING id
    `;
    if (jobsReabertos.length !== 1) {
      throw new ReprocessamentoManualAtivoError(estampa);
    }
    const job = await transaction.estampaJob.findUniqueOrThrow({
      where: {
        estampaId_tipo: {
          estampaId: estampa,
          tipo: TipoJobEstampa.AI_ANALYSIS,
        },
      },
    });
    await transaction.$executeRaw`
      UPDATE estampas
      SET processing_status = 'PENDING',
          processing_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${estampa}
    `;
    return job;
  });
}

export async function buscarEstampaJobPorId(id: string): Promise<EstampaJob | null> {
  return prisma.estampaJob.findUnique({
    where: { id: validarId(id, "id") },
  });
}

export async function listarEstampaJobsPorStatus(
  status: StatusJobEstampa,
  limite = 100,
): Promise<EstampaJob[]> {
  const take = validarInteiroPositivo(limite, "limite");
  return prisma.estampaJob.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    take,
  });
}

export async function listarEstampaJobsPorEstampa(
  estampaId: string | bigint,
): Promise<EstampaJob[]> {
  return prisma.estampaJob.findMany({
    where: { estampaId: validarEstampaId(estampaId) },
    orderBy: { createdAt: "desc" },
  });
}

export async function listarEstampaJobsPainel(
  input: ListarEstampaJobsPainelInput = {},
): Promise<{ jobs: EstampaJobPainelRow[]; total: number }> {
  const limite = validarInteiroPositivo(input.limite ?? 50, "limite");
  if (limite > 100) throw new Error("limite deve ser menor ou igual a 100.");
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset deve ser um número inteiro maior ou igual a zero.");
  }

  const filtroStatus = input.status
    ? Prisma.sql`AND job.status = ${input.status}::"StatusJobEstampa"`
    : Prisma.empty;
  const [jobs, totais] = await prisma.$transaction([
    prisma.$queryRaw<EstampaJobPainelRow[]>`
      SELECT
        job.id,
        job.estampa_id AS "estampaId",
        job.status,
        job.tentativas,
        job.max_tentativas AS "maxTentativas",
        job.ultimo_erro AS "ultimoErro",
        job.created_at AS "createdAt",
        job.started_at AS "startedAt",
        job.finished_at AS "finishedAt",
        job.manual_requested AS "manualRequested",
        catalogo.codigo,
        catalogo.variante,
        catalogo.preview_url AS "previewUrl",
        CASE WHEN job.status = 'COMPLETED'::"StatusJobEstampa" THEN catalogo.processed_at ELSE NULL END AS "processedAt",
        CASE WHEN job.status = 'COMPLETED'::"StatusJobEstampa" THEN catalogo.ai_metadata ELSE NULL END AS "aiMetadata"
      FROM estampa_jobs AS job
      INNER JOIN estampas AS catalogo ON catalogo.id = job.estampa_id
      WHERE job.tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
      ${filtroStatus}
      ORDER BY job.created_at DESC, job.id DESC
      LIMIT ${limite}
      OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM estampa_jobs AS job
      WHERE job.tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
      ${filtroStatus}
    `,
  ]);

  return { jobs, total: Number(totais[0]?.total ?? 0) };
}

export async function listarEstampaIdsComJobAtivo(
  estampaIds: Array<string | bigint>,
  tipo: TipoJobEstampa = TipoJobEstampa.AI_ANALYSIS,
): Promise<Set<bigint>> {
  if (estampaIds.length === 0) return new Set();

  const jobs = await prisma.estampaJob.findMany({
    where: {
      estampaId: { in: estampaIds.map((id) => validarEstampaId(id)) },
      tipo,
      status: { in: [StatusJobEstampa.PENDING, StatusJobEstampa.PROCESSING] },
    },
    distinct: ["estampaId"],
    select: { estampaId: true },
  });

  return new Set(jobs.map((job) => job.estampaId));
}

export async function buscarUltimoStatusJobsPorEstampa(
  estampaIds: Array<string | bigint>,
  tipo: TipoJobEstampa = TipoJobEstampa.AI_ANALYSIS,
): Promise<Map<bigint, StatusJobEstampa>> {
  if (estampaIds.length === 0) return new Map();

  const jobs = await prisma.estampaJob.findMany({
    where: {
      estampaId: { in: estampaIds.map((id) => validarEstampaId(id)) },
      tipo,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { estampaId: true, status: true },
  });
  const statusPorEstampa = new Map<bigint, StatusJobEstampa>();
  for (const job of jobs) {
    if (!statusPorEstampa.has(job.estampaId)) {
      statusPorEstampa.set(job.estampaId, job.status);
    }
  }
  return statusPorEstampa;
}

export async function criarEstampaJobsEmLote(
  estampaIds: Array<string | bigint>,
  tipo: TipoJobEstampa = TipoJobEstampa.AI_ANALYSIS,
): Promise<{ elegiveis: number; jobsCriados: number }> {
  if (estampaIds.length === 0) return { elegiveis: 0, jobsCriados: 0 };

  const idsUnicos = [...new Set(estampaIds.map((id) => validarEstampaId(id)))];
  const [resultado] = await prisma.$queryRaw<Array<{
    elegiveis: bigint;
    jobsCriados: bigint;
  }>>`
    WITH candidatas AS (
      SELECT DISTINCT unnest(ARRAY[${Prisma.join(idsUnicos)}]::BIGINT[]) AS estampa_id
    ), job_atual AS (
      SELECT
        job.estampa_id,
        job.status
      FROM estampa_jobs AS job
      INNER JOIN candidatas ON candidatas.estampa_id = job.estampa_id
      WHERE job.tipo = ${tipo}::"TipoJobEstampa"
    ), elegiveis AS (
      SELECT candidatas.estampa_id
      FROM candidatas
      LEFT JOIN job_atual ON job_atual.estampa_id = candidatas.estampa_id
      WHERE job_atual.status IS NULL
         OR job_atual.status = 'COMPLETED'::"StatusJobEstampa"
    ), agendados AS (
      INSERT INTO estampa_jobs (estampa_id, tipo)
      SELECT estampa_id, ${tipo}::"TipoJobEstampa"
      FROM elegiveis
      ON CONFLICT (estampa_id, tipo) DO UPDATE
      SET status = 'PENDING'::"StatusJobEstampa",
          tentativas = 0,
          ultimo_erro = NULL,
          next_attempt_at = CURRENT_TIMESTAMP,
          manual_requested = FALSE,
          manual_requested_at = NULL,
          manual_requested_by = NULL,
          created_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          started_at = NULL,
          finished_at = NULL,
          locked_at = NULL,
          worker_id = NULL
      WHERE estampa_jobs.status = 'COMPLETED'::"StatusJobEstampa"
      RETURNING id
    )
    SELECT
      (SELECT count(*)::BIGINT FROM elegiveis) AS elegiveis,
      (SELECT count(*)::BIGINT FROM agendados) AS "jobsCriados"
  `;

  return {
    elegiveis: Number(resultado?.elegiveis ?? 0),
    jobsCriados: Number(resultado?.jobsCriados ?? 0),
  };
}

export async function atualizarEstampaJob(
  id: string,
  input: AtualizarEstampaJobInput,
): Promise<EstampaJob> {
  if (input.status !== undefined) {
    throw new Error(
      "Use as funções específicas de transição para alterar o status do job e da estampa em conjunto.",
    );
  }
  const data: Prisma.EstampaJobUpdateInput = { ...input };

  if (input.tentativas !== undefined) data.tentativas = validarTentativas(input.tentativas);
  if (input.maxTentativas !== undefined) {
    data.maxTentativas = validarInteiroPositivo(input.maxTentativas, "maxTentativas");
  }
  if (Object.keys(data).length === 0) {
    throw new Error("Informe ao menos um campo para atualizar o job.");
  }

  return prisma.estampaJob.update({
    where: { id: validarId(id, "id") },
    data,
  });
}

export async function excluirEstampaJob(id: string): Promise<EstampaJob> {
  return prisma.estampaJob.delete({
    where: { id: validarId(id, "id") },
  });
}

export async function assumirProximoJobAiAnalysis(workerId: string): Promise<EstampaJob | null> {
  const worker = validarId(workerId, "workerId");
  const jobs = await prisma.$queryRaw<EstampaJob[]>`
    WITH proximo_job AS (
      SELECT id
      FROM estampa_jobs
      WHERE status = 'PENDING'::"StatusJobEstampa"
        AND tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
        AND tentativas < max_tentativas
        AND next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY next_attempt_at ASC, created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    , job_assumido AS (
      UPDATE estampa_jobs AS job
      SET status = 'PROCESSING'::"StatusJobEstampa",
          tentativas = job.tentativas + 1,
          started_at = CURRENT_TIMESTAMP,
          finished_at = NULL,
          locked_at = CURRENT_TIMESTAMP,
          worker_id = ${worker},
          ultimo_erro = NULL,
          next_attempt_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      FROM proximo_job
      WHERE job.id = proximo_job.id
      RETURNING job.*
    ), estampa_em_processamento AS (
      UPDATE estampas
      SET processing_status = 'PROCESSING',
          processing_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      FROM job_assumido
      WHERE estampas.id = job_assumido.estampa_id
      RETURNING estampas.id
    )
    SELECT
      job.id,
      job.estampa_id AS "estampaId",
      job.tipo,
      job.status,
      job.tentativas,
      job.max_tentativas AS "maxTentativas",
      job.ultimo_erro AS "ultimoErro",
      job.next_attempt_at AS "nextAttemptAt",
      job.manual_requested AS "manualRequested",
      job.manual_requested_at AS "manualRequestedAt",
      job.manual_requested_by AS "manualRequestedBy",
      job.created_at AS "createdAt",
      job.updated_at AS "updatedAt",
      job.started_at AS "startedAt",
      job.finished_at AS "finishedAt",
      job.locked_at AS "lockedAt",
      job.worker_id AS "workerId"
    FROM job_assumido AS job
  `;

  return jobs[0] ?? null;
}

export async function concluirEstampaJob(
  id: string,
  workerId: string,
  estampaId: string | bigint,
  aiProcessedHash: string,
): Promise<boolean> {
  const jobId = validarId(id, "id");
  const worker = validarId(workerId, "workerId");
  const estampa = validarEstampaId(estampaId);
  const hash = normalizarHashConteudo(aiProcessedHash);
  if (!hash) throw new Error("aiProcessedHash é obrigatório para concluir o job.");

  return prisma.$transaction(async (transaction) => {
    const resultado = await transaction.estampaJob.updateMany({
      where: {
        id: jobId,
        estampaId: estampa,
        workerId: worker,
        status: StatusJobEstampa.PROCESSING,
      },
      data: {
        status: StatusJobEstampa.COMPLETED,
        finishedAt: new Date(),
        lockedAt: null,
        workerId: null,
        ultimoErro: null,
        nextAttemptAt: new Date(),
      },
    });
    if (resultado.count !== 1) return false;

    const estampasAtualizadas = await transaction.$executeRaw`
      UPDATE estampas
      SET ai_processed_hash = ${hash},
          processing_status = 'COMPLETED',
          processing_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${estampa}
        AND content_hash = ${hash}
    `;
    if (estampasAtualizadas !== 1) {
      throw new Error("A versão da estampa mudou antes da conclusão do job.");
    }
    return true;
  });
}

export async function concluirEstampaJobIgnorado(
  id: string,
  workerId: string,
  estampaId: string | bigint,
  contentHash: string,
): Promise<boolean> {
  const jobId = validarId(id, "id");
  const worker = validarId(workerId, "workerId");
  const estampa = validarEstampaId(estampaId);
  const hash = normalizarHashConteudo(contentHash);
  if (!hash) throw new Error("contentHash é obrigatório para ignorar o job.");
  return prisma.$transaction(async (transaction) => {
    const resultado = await transaction.estampaJob.updateMany({
      where: {
        id: jobId,
        estampaId: estampa,
        workerId: worker,
        status: StatusJobEstampa.PROCESSING,
      },
      data: {
        status: StatusJobEstampa.COMPLETED,
        finishedAt: new Date(),
        lockedAt: null,
        workerId: null,
        ultimoErro: null,
        nextAttemptAt: new Date(),
      },
    });
    if (resultado.count !== 1) return false;
    const estampasAtualizadas = await transaction.$executeRaw`
      UPDATE estampas
      SET processing_status = 'COMPLETED',
          processing_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${estampa}
        AND content_hash = ${hash}
        AND ai_processed_hash = ${hash}
    `;
    if (estampasAtualizadas !== 1) {
      throw new Error("A versão da estampa mudou antes de concluir o job ignorado.");
    }
    return true;
  });
}

export async function renovarLockEstampaJob(id: string, workerId: string): Promise<boolean> {
  const resultado = await prisma.estampaJob.updateMany({
    where: {
      id: validarId(id, "id"),
      workerId: validarId(workerId, "workerId"),
      status: StatusJobEstampa.PROCESSING,
    },
    data: { lockedAt: new Date() },
  });
  return resultado.count === 1;
}

export async function registrarFalhaEstampaJob(
  job: Pick<EstampaJob, "id" | "estampaId" | "tentativas" | "maxTentativas">,
  workerId: string,
  erro: string,
  retriable = true,
): Promise<StatusJobEstampa | null> {
  const esgotouTentativas = !retriable || job.tentativas >= job.maxTentativas;
  const proximoStatus = esgotouTentativas
    ? StatusJobEstampa.FAILED
    : StatusJobEstampa.PENDING;
  const mensagem = erro.slice(0, 10_000);
  const nextAttemptAt = esgotouTentativas
    ? new Date()
    : new Date(Date.now() + calcularBackoffRetryMs(job.tentativas));
  return prisma.$transaction(async (transaction) => {
    const resultado = await transaction.estampaJob.updateMany({
      where: {
        id: validarId(job.id, "id"),
        estampaId: validarEstampaId(job.estampaId),
        workerId: validarId(workerId, "workerId"),
        status: StatusJobEstampa.PROCESSING,
      },
      data: {
        status: proximoStatus,
        ultimoErro: mensagem,
        nextAttemptAt,
        finishedAt: esgotouTentativas ? new Date() : null,
        startedAt: esgotouTentativas ? undefined : null,
        lockedAt: null,
        workerId: null,
      },
    });
    if (resultado.count !== 1) return null;
    await transaction.$executeRaw`
      UPDATE estampas
      SET processing_status = ${proximoStatus},
          processing_error = ${mensagem},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${job.estampaId}
    `;
    return proximoStatus;
  });
}

export async function recuperarJobsAiAnalysisAbandonados(
  lockTimeoutMs: number,
): Promise<ResultadoRecuperacaoJobs> {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new Error("lockTimeoutMs deve ser um inteiro maior que zero.");
  }
  const limite = new Date(Date.now() - lockTimeoutMs);
  const totais = await prisma.$queryRaw<Array<{ status: StatusJobEstampa; total: number }>>`
    WITH jobs_travados AS (
      SELECT id
      FROM estampa_jobs
      WHERE tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
        AND status = 'PROCESSING'::"StatusJobEstampa"
        AND COALESCE(locked_at, started_at, updated_at) < ${limite}
      FOR UPDATE SKIP LOCKED
    ), jobs_recuperados AS (
      UPDATE estampa_jobs AS job
      SET status = CASE
            WHEN job.tentativas >= job.max_tentativas THEN 'FAILED'::"StatusJobEstampa"
            ELSE 'PENDING'::"StatusJobEstampa"
          END,
          ultimo_erro = 'Lock expirado após interrupção do worker.',
          next_attempt_at = CASE
            WHEN job.tentativas >= job.max_tentativas THEN CURRENT_TIMESTAMP
            ELSE CURRENT_TIMESTAMP + make_interval(
              secs => LEAST(
                ${Math.floor(ESTAMPA_RETRY_MAX_DELAY_MS / 1000)},
                ${Math.floor(ESTAMPA_RETRY_BASE_DELAY_MS / 1000)} * power(2, GREATEST(job.tentativas - 1, 0))
              )::double precision
            )
          END,
          started_at = CASE
            WHEN job.tentativas >= job.max_tentativas THEN job.started_at
            ELSE NULL
          END,
          finished_at = CASE
            WHEN job.tentativas >= job.max_tentativas THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          locked_at = NULL,
          worker_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      FROM jobs_travados
      WHERE job.id = jobs_travados.id
      RETURNING job.estampa_id, job.status
    ), estampas_recuperadas AS (
      UPDATE estampas
      SET processing_status = jobs_recuperados.status::text,
          processing_error = 'Lock expirado após interrupção do worker.',
          updated_at = CURRENT_TIMESTAMP
      FROM jobs_recuperados
      WHERE estampas.id = jobs_recuperados.estampa_id
      RETURNING estampas.id
    )
    SELECT status, COUNT(*)::integer AS total
    FROM jobs_recuperados
    GROUP BY status
  `;

  const reencaminhados = totais.find((item) => item.status === StatusJobEstampa.PENDING)?.total ?? 0;
  const falhos = totais.find((item) => item.status === StatusJobEstampa.FAILED)?.total ?? 0;
  return {
    recuperados: reencaminhados + falhos,
    reencaminhados,
    falhos,
  };
}

export type ResultadoRecuperacaoJobs = {
  recuperados: number;
  reencaminhados: number;
  falhos: number;
};

export { StatusJobEstampa, TipoJobEstampa };
