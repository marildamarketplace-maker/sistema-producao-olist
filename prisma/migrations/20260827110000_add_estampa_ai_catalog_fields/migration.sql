ALTER TABLE "estampa"
ADD COLUMN IF NOT EXISTS "variante" TEXT,
ADD COLUMN IF NOT EXISTS "preview_url" TEXT,
ADD COLUMN IF NOT EXISTS "storage_key" TEXT,
ADD COLUMN IF NOT EXISTS "original_relative_path" TEXT,
ADD COLUMN IF NOT EXISTS "original_filename" TEXT,
ADD COLUMN IF NOT EXISTS "content_hash" TEXT,
ADD COLUMN IF NOT EXISTS "titulo" TEXT,
ADD COLUMN IF NOT EXISTS "tema" TEXT,
ADD COLUMN IF NOT EXISTS "subtemas" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "cores" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "elementos_visuais" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "ocasioes" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "categorias" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "estilo" TEXT,
ADD COLUMN IF NOT EXISTS "texto_pesquisa" TEXT,
ADD COLUMN IF NOT EXISTS "ai_metadata" JSONB,
ADD COLUMN IF NOT EXISTS "ai_processed_hash" TEXT,
ADD COLUMN IF NOT EXISTS "processing_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "processing_error" TEXT,
ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "estampa"
ADD CONSTRAINT "estampa_processing_status_check"
CHECK ("processing_status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));

DROP INDEX IF EXISTS "uq_estampa_codigo";

CREATE UNIQUE INDEX "uq_estampa_codigo_sem_variante"
ON "estampa" ("codigo")
WHERE "variante" IS NULL;

CREATE UNIQUE INDEX "uq_estampa_codigo_variante"
ON "estampa" ("codigo", "variante")
WHERE "variante" IS NOT NULL;

CREATE INDEX "idx_estampa_processing_status"
ON "estampa" ("processing_status");

CREATE INDEX "idx_estampa_content_hash"
ON "estampa" ("content_hash");
