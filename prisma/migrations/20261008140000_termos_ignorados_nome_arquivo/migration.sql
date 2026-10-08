ALTER TABLE "configuracoes_jobs"
ADD COLUMN "termos_ignorados_nome_arquivo" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE "configuracoes_jobs"
SET "termos_ignorados_nome_arquivo" = ARRAY['-', '.', 'MOCKUP']::text[],
    "updated_at" = CURRENT_TIMESTAMP
WHERE "chave" = 'processar-estampas';
