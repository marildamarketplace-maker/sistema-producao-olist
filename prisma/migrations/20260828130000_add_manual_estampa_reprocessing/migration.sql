ALTER TABLE "estampa_jobs"
ADD COLUMN IF NOT EXISTS "manual_requested" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "manual_requested_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "manual_requested_by" UUID;

DO $$ BEGIN
  ALTER TABLE "estampa_jobs"
  ADD CONSTRAINT "estampa_jobs_manual_request_check"
  CHECK (
    ("manual_requested" = FALSE AND "manual_requested_at" IS NULL AND "manual_requested_by" IS NULL)
    OR
    ("manual_requested" = TRUE AND "manual_requested_at" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
