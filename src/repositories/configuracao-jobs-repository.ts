import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const CHAVE_JOB_PROCESSAR_ESTAMPAS = "processar-estampas";

export async function processarEstampasEstaPausado(): Promise<boolean> {
  const configuracao = await prisma.configuracaoJob.findUnique({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    select: { pausado: true },
  });
  // Ausência de configuração mantém o processamento desativado.
  return configuracao?.pausado ?? true;
}

export async function obterTermosIgnoradosNomeArquivoEstampas(): Promise<string[]> {
  const configuracao = await prisma.configuracaoJob.findUnique({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    select: { termosIgnoradosNomeArquivo: true },
  });
  return configuracao?.termosIgnoradosNomeArquivo ?? [];
}

export async function obterConfiguracaoJobEstampas() {
  const configuracao = await prisma.configuracaoJob.findUnique({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    select: { pausado: true, termosIgnoradosNomeArquivo: true, variantesPermitidas: true },
  });
  return configuracao ?? { pausado: true, termosIgnoradosNomeArquivo: [], variantesPermitidas: [] };
}

export async function salvarConfiguracaoJobEstampas(
  dados: import("@/domain/configuracao-job-estampas").ConfiguracaoJobEstampas,
) {
  return prisma.configuracaoJob.upsert({
    where: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS },
    create: { chave: CHAVE_JOB_PROCESSAR_ESTAMPAS, ...dados },
    update: dados,
    select: { pausado: true, termosIgnoradosNomeArquivo: true, variantesPermitidas: true },
  });
}

/** Só o cron autenticado aplica a pausa; leituras de configuração não têm efeitos. */
export async function pausarProcessarEstampasPorInatividade(): Promise<boolean> {
  const semAtividade = Prisma.sql`NOT EXISTS (
    SELECT 1 FROM estampa_jobs AS job
    WHERE job.tipo = 'AI_ANALYSIS'::"TipoJobEstampa"
      AND (job.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        OR job.updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        OR job.status = 'PROCESSING'::"StatusJobEstampa")
  )`;
  // Evita bloquear escritas na fila enquanto houver atividade recente.
  const [candidata] = await prisma.$queryRaw<Array<{ inativa: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM configuracoes_jobs
      WHERE chave = ${CHAVE_JOB_PROCESSAR_ESTAMPAS} AND pausado = FALSE
        AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
        AND ${semAtividade}
    ) AS inativa
  `;
  if (!candidata?.inativa) return false;

  return prisma.$transaction(async tx => {
    // Protege a segunda verificação contra INSERT/UPDATE concorrente de jobs.
    // Ordem consistente: fila primeiro, configuração depois; espera limitada.
    await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
    await tx.$executeRaw`LOCK TABLE estampa_jobs IN SHARE MODE`;
    const alteradas = await tx.$executeRaw`
      UPDATE configuracoes_jobs SET pausado = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE chave = ${CHAVE_JOB_PROCESSAR_ESTAMPAS} AND pausado = FALSE
        AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
        AND ${semAtividade}
    `;
    return alteradas > 0;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
