-- ETAPA COMPATÍVEL: não remove dados nem estruturas legadas.
-- A contração destrutiva foi separada em scripts/sql/contrair-recebimento-legado.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Serializa admissão de novas execuções com a mudança da configuração.
LOCK TABLE olist_sync_configuracao IN EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM olist_sync_execucao
             WHERE status IN ('PENDENTE', 'AUDITANDO', 'APLICANDO', 'AGUARDANDO_RETRY')) THEN
    RAISE EXCEPTION 'Aguarde a conclusão e conciliação das execuções de sincronização antes da contração';
  END IF;
END $$;
CREATE TEMP TABLE configuracoes_recebimento_ajustadas ON COMMIT DROP AS
SELECT id FROM olist_sync_configuracao WHERE 'FORMA_PAGAMENTO' = ANY(entidades);
UPDATE olist_sync_configuracao
SET entidades = array_remove(entidades, 'FORMA_PAGAMENTO'),
    ativo = ativo AND cardinality(array_remove(entidades, 'FORMA_PAGAMENTO')) > 0,
    versao = versao + 1, readiness_json = '{}'::jsonb,
    updated_at = now()
WHERE id IN (SELECT id FROM configuracoes_recebimento_ajustadas);
ALTER TABLE olist_sync_configuracao ALTER COLUMN entidades
SET DEFAULT ARRAY['PRODUTO','CONTATO','VENDEDOR']::text[];
-- Apenas provas correntes são invalidadas; observações/eventos criptografados
-- e execuções anteriores não são modificados ou reinterpretados.
UPDATE olist_sync_cobertura
SET completa_em = NULL, watermark_confirmado = NULL,
    incremental_validado = false, incremental_validado_em = NULL,
    geracao = geracao + 1, updated_at = now()
WHERE configuracao_id IN (SELECT id FROM configuracoes_recebimento_ajustadas);
-- Preservar associações e permissão legadas nesta etapa compatível.
-- A exclusão exige o runbook e scripts/sql/contrair-recebimento-legado.sql.
COMMIT;
