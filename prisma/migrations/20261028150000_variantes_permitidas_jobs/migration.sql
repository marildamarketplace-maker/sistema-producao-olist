ALTER TABLE "configuracoes_jobs"
ADD COLUMN "variantes_permitidas" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
