ALTER TABLE "estampa_jobs"
ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_estampa_jobs_status_next_attempt_at"
ON "estampa_jobs" ("status", "next_attempt_at");
