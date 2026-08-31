BEGIN;

-- O job representa o estado operacional atual da análise, não um histórico de execuções.
-- Mantém somente a linha mais recente antes de tornar a unicidade permanente.
LOCK TABLE public.estampa_jobs IN SHARE ROW EXCLUSIVE MODE;

WITH jobs_ordenados AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY estampa_id, tipo
      ORDER BY created_at DESC, updated_at DESC, id DESC
    ) AS ordem
  FROM public.estampa_jobs
)
DELETE FROM public.estampa_jobs AS job
USING jobs_ordenados
WHERE job.id = jobs_ordenados.id
  AND jobs_ordenados.ordem > 1;

DROP INDEX IF EXISTS public.uq_estampa_jobs_active_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estampa_jobs_estampa_tipo
ON public.estampa_jobs (estampa_id, tipo);

COMMIT;
