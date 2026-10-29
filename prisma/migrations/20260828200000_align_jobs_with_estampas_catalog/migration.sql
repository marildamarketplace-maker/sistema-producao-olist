-- Ajuste pontual baseado na auditoria de 2026-10-29.
-- Requer a estrutura existente; nao e uma migration de criacao inicial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.estampa_jobs'::regclass AND conname = 'estampa_jobs_estampa_id_fkey') THEN
    ALTER TABLE public.estampa_jobs ADD CONSTRAINT estampa_jobs_estampa_id_fkey FOREIGN KEY (estampa_id) REFERENCES public.estampas(id) ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE public.estampa_jobs VALIDATE CONSTRAINT estampa_jobs_estampa_id_fkey;

-- Mantem BIGINT e a funcao final existente. Nenhum job e removido ou reprocessado.
-- REVOKE PUBLIC sozinho nao remove o grant direto de anon.
REVOKE ALL ON FUNCTION public.buscar_estampas_por_relevancia(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_estampas_por_relevancia(TEXT, INTEGER, INTEGER) TO authenticated, service_role;

COMMIT;
