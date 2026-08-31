ALTER TYPE "StatusJobEstampa" ADD VALUE IF NOT EXISTS 'WAITING_PROVIDER';

DO $$ BEGIN
  CREATE TYPE "StatusEstampaAiBatch" AS ENUM (
    'PREPARING', 'SUBMITTED', 'IN_PROGRESS', 'COMPLETED',
    'FAILED', 'CANCELLED', 'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "estampa_ai_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL DEFAULT 'openai',
  "provider_batch_id" TEXT UNIQUE,
  "input_file_id" TEXT,
  "output_file_id" TEXT,
  "error_file_id" TEXT,
  "status" "StatusEstampaAiBatch" NOT NULL DEFAULT 'PREPARING',
  "quantidade_jobs" INTEGER NOT NULL DEFAULT 0,
  "quantidade_concluidos" INTEGER NOT NULL DEFAULT 0,
  "quantidade_falhas" INTEGER NOT NULL DEFAULT 0,
  "ultimo_erro" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "failed_at" TIMESTAMPTZ,
  "last_checked_at" TIMESTAMPTZ
);

ALTER TABLE "estampa_jobs"
  ADD COLUMN IF NOT EXISTS "batch_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider_custom_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "estampa_jobs"
    ADD CONSTRAINT "estampa_jobs_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "estampa_ai_batches"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_estampa_ai_batches_status_created_at"
  ON "estampa_ai_batches" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_estampa_jobs_batch_id"
  ON "estampa_jobs" ("batch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_estampa_jobs_provider_custom_id"
  ON "estampa_jobs" ("provider_custom_id")
  WHERE "provider_custom_id" IS NOT NULL;

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
        'PROCESSING'::public."StatusJobEstampa",
        'WAITING_PROVIDER'::public."StatusJobEstampa"
      )
    LIMIT 1;

    IF OLD.processing_status = 'PROCESSING'
      AND job_ativo_status IN ('PROCESSING', 'WAITING_PROVIDER') THEN
      NEW.processing_status := 'PROCESSING';
    ELSIF OLD.processing_status = 'COMPLETED'
      AND OLD.content_hash IS NOT NULL
      AND OLD.content_hash = OLD.ai_processed_hash
      AND NEW.ai_processed_hash IS NOT DISTINCT FROM OLD.ai_processed_hash
      AND NOT (job_ativo_status = 'PENDING' AND COALESCE(job_ativo_manual, FALSE)) THEN
      NEW.processing_status := 'COMPLETED';
    ELSIF OLD.processing_status = 'FAILED' AND job_ativo_status IS NULL THEN
      NEW.processing_status := 'FAILED';
    END IF;
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;
