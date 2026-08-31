CREATE INDEX IF NOT EXISTS "idx_estampas_status_created_at"
ON "estampas" ("processing_status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_estampas_codigo_variante_lower"
ON "estampas" (lower("codigo"), lower(COALESCE("variante", '')));

CREATE INDEX IF NOT EXISTS "idx_estampas_tema_lower"
ON "estampas" (lower(COALESCE("tema", '')));

CREATE INDEX IF NOT EXISTS "idx_estampas_elementos_visuais_gin"
ON "estampas" USING GIN ("elementos_visuais");

CREATE INDEX IF NOT EXISTS "idx_estampas_ocasioes_gin"
ON "estampas" USING GIN ("ocasioes");

CREATE INDEX IF NOT EXISTS "idx_estampas_categorias_gin"
ON "estampas" USING GIN ("categorias");

CREATE INDEX IF NOT EXISTS "idx_estampas_cores_gin"
ON "estampas" USING GIN ("cores");

CREATE INDEX IF NOT EXISTS "idx_estampas_search_vector_gin"
ON "estampas" USING GIN ("search_vector");
