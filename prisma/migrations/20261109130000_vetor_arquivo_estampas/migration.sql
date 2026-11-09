BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- A expressão depende das regras do dicionário extensions.unaccent.
-- Se essas regras mudarem, recrie a coluna gerada e o índice para recalcular as linhas.
CREATE FUNCTION public.estampas_gerar_vetor_arquivo(text, text, text)
RETURNS pg_catalog.tsvector
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT to_tsvector('pg_catalog.simple'::regconfig, regexp_replace(
    extensions.unaccent('extensions.unaccent'::regdictionary,
      COALESCE($1, '') || ' ' || COALESCE($2, '') || ' ' || COALESCE($3, '')
    ), '[^[:alnum:]]+', ' ', 'g'
  ))
$$;

-- STORED recalcula os registros legados na reescrita da tabela, sem disparar
-- os triggers de UPDATE que alteram updated_at e preservam o estado de IA.
ALTER TABLE public.estampas
  ADD COLUMN search_vector_arquivo pg_catalog.tsvector GENERATED ALWAYS AS (
    public.estampas_gerar_vetor_arquivo(original_filename, original_relative_path, storage_key)
  ) STORED NOT NULL;

COMMIT;
