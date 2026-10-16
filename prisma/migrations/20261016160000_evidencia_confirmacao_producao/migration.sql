ALTER TABLE "solicitacoes_producao"
  ADD COLUMN "evidencia_url" TEXT,
  ADD COLUMN "evidencia_bucket" TEXT,
  ADD COLUMN "evidencia_storage_path" TEXT;

-- Confirmações históricas continuam sem foto. Novas confirmações exigem evidência na aplicação.
ALTER TABLE "solicitacoes_producao" ADD CONSTRAINT "solicitacoes_producao_evidencia_completa"
  CHECK (
    (evidencia_url IS NULL AND evidencia_bucket IS NULL AND evidencia_storage_path IS NULL)
    OR (evidencia_url IS NOT NULL AND evidencia_bucket IS NOT NULL AND evidencia_storage_path IS NOT NULL)
  );
