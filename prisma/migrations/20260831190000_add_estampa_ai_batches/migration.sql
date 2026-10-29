-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Nao altera enums, funcoes, estados ou tabelas de batch existentes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estampa_jobs_provider_custom_id
  ON public.estampa_jobs (provider_custom_id) WHERE provider_custom_id IS NOT NULL;

COMMIT;
