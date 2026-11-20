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

/** Conta operações por destino/entidade desta execução, inclusive propostas de auditorias anteriores. */
export function consultaFilaAplicacaoSync(grupo: string, execucaoId: string) {
  return Prisma.sql`
    WITH alvos AS (
      SELECT s.aplicativo_id, s.entidade, s.created_at, s.status, s.cursor_json->>'operacaoId' AS operacao_atual
      FROM olist_sync_etapa s JOIN olist_sync_execucao e ON e.id=s.execucao_id
      WHERE e.configuracao_id=${grupo}::uuid AND e.id=${execucaoId}::uuid AND s.fase='APLICAR'
    )
    SELECT (SELECT min(created_at) FROM alvos) AS iniciada,
      count(*) FILTER (WHERE a.status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY','PAUSADA')
        AND (o.status IN ('AUTORIZADA','EM_APLICACAO','VERIFICANDO')
          OR (o.status='RESULTADO_INCONCLUSIVO' AND (o.execucao_id<>${execucaoId}::uuid OR o.id::text=a.operacao_atual))))::int AS restantes,
      count(*) FILTER (WHERE o.status='FALHA_PERMANENTE' OR (o.status='RESULTADO_INCONCLUSIVO'
        AND (o.execucao_id=${execucaoId}::uuid OR o.execucao_id IS NULL)
        AND o.id::text IS DISTINCT FROM a.operacao_atual))::int AS falhas
    FROM olist_sync_operacao o JOIN olist_sync_registro r ON r.id=o.registro_id AND r.configuracao_id=o.configuracao_id
      JOIN alvos a ON a.aplicativo_id=o.destino_app_id AND a.entidade=r.entidade
    WHERE o.configuracao_id=${grupo}::uuid
      AND o.status IN ('AUTORIZADA','EM_APLICACAO','VERIFICANDO','RESULTADO_INCONCLUSIVO','FALHA_PERMANENTE')`;
}

/** O índice de grupo/data limita a janela; só retorna um total, sem metadados pessoais. */
export function consultaConfirmacoesRecentesSync(grupo: string, execucaoId: string, inicio: Date, fim: Date) {
  return Prisma.sql`
    SELECT count(*)::int AS total FROM olist_sync_evento
    WHERE configuracao_id=${grupo}::uuid AND execucao_id=${execucaoId}::uuid AND tipo='ESCRITA_CONFIRMADA'
      AND created_at>${inicio.toISOString()}::timestamptz AND created_at<=${fim.toISOString()}::timestamptz`;
}
