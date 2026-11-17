import { Prisma, type PrismaClient } from "@prisma/client";

/** Uma linha agregada, sem payloads. O índice parcial cobre grupo, execução e janela. */
export function consultaValidacoesRecentesSync(grupo: string, execucaoId: string, inicio: Date, fim: Date) {
  return Prisma.sql`
    SELECT count(*)::int AS total
    FROM olist_sync_estado
    WHERE configuracao_id = ${grupo}::uuid AND ultima_execucao_id = ${execucaoId}::uuid
      AND verificado_em > ${inicio.toISOString()}::timestamptz AND verificado_em <= ${fim.toISOString()}::timestamptz
      AND metadados_json @> '{"completo":true}'::jsonb`;
}

export async function contarValidacoesRecentesSync(db: Pick<PrismaClient, "$queryRaw">,
  grupo: string, execucaoId: string, inicio: Date, fim: Date): Promise<number> {
  const [resultado] = await db.$queryRaw<{ total: number }[]>(consultaValidacoesRecentesSync(grupo, execucaoId, inicio, fim));
  return resultado?.total ?? 0;
}
