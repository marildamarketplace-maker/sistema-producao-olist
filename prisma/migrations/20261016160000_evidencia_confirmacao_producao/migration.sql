-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.solicitacoes_producao'::regclass AND conname = 'solicitacoes_producao_evidencia_completa') THEN
    ALTER TABLE public.solicitacoes_producao ADD CONSTRAINT solicitacoes_producao_evidencia_completa CHECK (
    (evidencia_url IS NULL AND evidencia_bucket IS NULL AND evidencia_storage_path IS NULL)
    OR (evidencia_url IS NOT NULL AND evidencia_bucket IS NOT NULL AND evidencia_storage_path IS NOT NULL)
  ) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.solicitacoes_producao VALIDATE CONSTRAINT solicitacoes_producao_evidencia_completa;

COMMIT;
