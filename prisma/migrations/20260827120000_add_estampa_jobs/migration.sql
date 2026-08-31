DO $$ BEGIN
  CREATE TYPE "TipoJobEstampa" AS ENUM ('AI_ANALYSIS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StatusJobEstampa" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "estampa_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "estampa_id" UUID NOT NULL,
    "tipo" "TipoJobEstampa" NOT NULL DEFAULT 'AI_ANALYSIS',
    "status" "StatusJobEstampa" NOT NULL DEFAULT 'PENDING',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "max_tentativas" INTEGER NOT NULL DEFAULT 3,
    "ultimo_erro" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "worker_id" TEXT,

    CONSTRAINT "estampa_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "estampa_jobs_tentativas_check" CHECK ("tentativas" >= 0),
    CONSTRAINT "estampa_jobs_max_tentativas_check" CHECK ("max_tentativas" > 0),
    CONSTRAINT "estampa_jobs_tentativas_max_check" CHECK ("tentativas" <= "max_tentativas")
);

CREATE INDEX IF NOT EXISTS "idx_estampa_jobs_status" ON "estampa_jobs"("status");
CREATE INDEX IF NOT EXISTS "idx_estampa_jobs_estampa_id" ON "estampa_jobs"("estampa_id");
CREATE INDEX IF NOT EXISTS "idx_estampa_jobs_created_at" ON "estampa_jobs"("created_at");

DO $$ BEGIN
  ALTER TABLE "estampa_jobs"
  ADD CONSTRAINT "estampa_jobs_estampa_id_fkey"
  FOREIGN KEY ("estampa_id") REFERENCES "estampa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
