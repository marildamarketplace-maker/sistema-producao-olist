CREATE UNIQUE INDEX IF NOT EXISTS "uq_estampa_jobs_active_type"
ON "estampa_jobs" ("estampa_id", "tipo")
WHERE "status" IN ('PENDING', 'PROCESSING');
