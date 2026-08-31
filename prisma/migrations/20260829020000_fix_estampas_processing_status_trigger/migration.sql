BEGIN;

CREATE OR REPLACE FUNCTION public.estampas_preservar_estado_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    job_ativo_status TEXT;
    job_ativo_manual BOOLEAN;
BEGIN
    -- Uma nova versão da imagem sempre exige uma nova análise.
    IF OLD.content_hash IS DISTINCT FROM NEW.content_hash THEN
        NEW.processing_status := 'PENDING';
        NEW.processing_error := NULL;
    ELSIF NEW.processing_status = 'PENDING'
       AND OLD.processing_status IN ('PROCESSING', 'COMPLETED', 'FAILED') THEN
        SELECT job.status::TEXT, job.manual_requested
          INTO job_ativo_status, job_ativo_manual
        FROM public.estampa_jobs AS job
        WHERE job.estampa_id = OLD.id
          AND job.tipo = 'AI_ANALYSIS'::public."TipoJobEstampa"
          AND job.status IN (
            'PENDING'::public."StatusJobEstampa",
            'PROCESSING'::public."StatusJobEstampa"
          )
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT 1;

        -- Impede que uma sincronização do indexador rebaixe um processamento ativo.
        IF OLD.processing_status = 'PROCESSING'
           AND job_ativo_status = 'PROCESSING' THEN
            NEW.processing_status := 'PROCESSING';

        -- Preserva uma análise atual contra upserts do indexador que enviem PENDING.
        ELSIF OLD.processing_status = 'COMPLETED'
          AND OLD.content_hash IS NOT NULL
          AND OLD.content_hash = OLD.ai_processed_hash
          AND NEW.ai_processed_hash IS NOT DISTINCT FROM OLD.ai_processed_hash
          AND NOT (
            job_ativo_status = 'PENDING'
            AND COALESCE(job_ativo_manual, FALSE)
          ) THEN
            NEW.processing_status := 'COMPLETED';

        -- FAILED só retorna a PENDING por retry ou reprocessamento explícito.
        ELSIF OLD.processing_status = 'FAILED'
          AND job_ativo_status IS NULL THEN
            NEW.processing_status := 'FAILED';
        END IF;
    END IF;

    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS estampas_preservar_estado_ia_trigger ON public.estampas;
CREATE TRIGGER estampas_preservar_estado_ia_trigger
BEFORE UPDATE ON public.estampas
FOR EACH ROW
EXECUTE FUNCTION public.estampas_preservar_estado_ia();

-- Evita concorrência com workers durante a reconciliação pontual.
LOCK TABLE public.estampa_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;

WITH ultimo_job AS (
    SELECT DISTINCT ON (job.estampa_id)
        job.estampa_id,
        job.status,
        job.ultimo_erro
    FROM public.estampa_jobs AS job
    WHERE job.tipo = 'AI_ANALYSIS'::public."TipoJobEstampa"
    ORDER BY job.estampa_id, job.created_at DESC, job.id DESC
), estado_correto AS (
    SELECT
        estampa.id,
        CASE
            WHEN ultimo_job.status = 'COMPLETED'::public."StatusJobEstampa"
              AND estampa.content_hash IS NOT NULL
              AND estampa.content_hash = estampa.ai_processed_hash
              AND estampa.processed_at IS NOT NULL
            THEN 'COMPLETED'
            WHEN ultimo_job.status = 'PROCESSING'::public."StatusJobEstampa"
            THEN 'PROCESSING'
            WHEN ultimo_job.status = 'FAILED'::public."StatusJobEstampa"
            THEN 'FAILED'
            ELSE 'PENDING'
        END AS processing_status,
        ultimo_job.ultimo_erro
    FROM public.estampas AS estampa
    INNER JOIN ultimo_job ON ultimo_job.estampa_id = estampa.id
)
UPDATE public.estampas AS estampa
SET processing_status = estado_correto.processing_status,
    processing_error = CASE
        WHEN estado_correto.processing_status IN ('COMPLETED', 'PROCESSING') THEN NULL
        ELSE COALESCE(estado_correto.ultimo_erro, estampa.processing_error)
    END,
    updated_at = CURRENT_TIMESTAMP
FROM estado_correto
WHERE estado_correto.id = estampa.id
  AND (
    estampa.processing_status IS DISTINCT FROM estado_correto.processing_status
    OR (
      estado_correto.processing_status IN ('COMPLETED', 'PROCESSING')
      AND estampa.processing_error IS NOT NULL
    )
  );

COMMIT;
