UPDATE "configuracoes_jobs"
SET "termos_ignorados_nome_arquivo" = array_append("termos_ignorados_nome_arquivo", 'MOCLKUP'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "chave" = 'processar-estampas'
  AND NOT EXISTS (
    SELECT 1 FROM unnest("termos_ignorados_nome_arquivo") AS termo
    WHERE upper(btrim(termo)) = 'MOCLKUP'
  );
