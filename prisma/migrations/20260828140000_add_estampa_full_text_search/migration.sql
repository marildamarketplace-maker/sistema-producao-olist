ALTER TABLE "estampa"
ADD COLUMN IF NOT EXISTS "search_vector" TSVECTOR
GENERATED ALWAYS AS (
  setweight(
    to_tsvector(
      'simple',
      COALESCE("codigo", '') || ' ' || COALESCE("variante", '')
    ),
    'A'
  )
  || setweight(
    to_tsvector(
      'portuguese',
      COALESCE("titulo", '') || ' ' || COALESCE("tema", '')
    ),
    'A'
  )
  || setweight(
    to_tsvector('portuguese', COALESCE("texto_pesquisa", '')),
    'B'
  )
  || setweight(
    to_tsvector('portuguese', COALESCE("descricao", '')),
    'C'
  )
) STORED;

CREATE INDEX IF NOT EXISTS "idx_estampa_search_vector_gin"
ON "estampa"
USING GIN ("search_vector");

CREATE OR REPLACE FUNCTION "buscar_estampas_por_relevancia"(
  "p_consulta" TEXT,
  "p_limite" INTEGER DEFAULT 50,
  "p_offset" INTEGER DEFAULT 0
)
RETURNS TABLE ("estampa" JSONB, "relevancia" REAL)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH entrada AS (
    SELECT
      lower(btrim("p_consulta")) AS texto,
      regexp_match(
        lower(btrim("p_consulta")),
        '^([0-9][[:alnum:].]*)[[:space:]/-]+([[:alnum:]]+)$'
      ) AS codigo_variante,
      CASE
        WHEN lower(btrim("p_consulta")) ~ '^[0-9][[:alnum:].]*$'
        THEN lower(btrim("p_consulta"))
        ELSE NULL
      END AS codigo_isolado
    WHERE btrim("p_consulta") <> ''
  ), consulta AS (
    SELECT
      entrada.*,
      websearch_to_tsquery(
        'portuguese',
        CASE
          WHEN entrada.codigo_variante IS NOT NULL
          THEN entrada.codigo_variante[1] || ' ' || entrada.codigo_variante[2]
          ELSE entrada.texto
        END
      ) AS termos
    FROM entrada
  ), resultados AS (
    SELECT
      e.*,
      (
        ts_rank_cd(e."search_vector", consulta.termos, 32)
        + CASE
            WHEN consulta.codigo_variante IS NOT NULL
              AND lower(e."codigo") = consulta.codigo_variante[1]
              AND lower(COALESCE(e."variante", '')) = consulta.codigo_variante[2]
            THEN 1000.0
            ELSE 0.0
          END
        + CASE
            WHEN consulta.codigo_isolado IS NOT NULL
              AND lower(e."codigo") = consulta.codigo_isolado
            THEN 500.0
            ELSE 0.0
          END
        + CASE WHEN lower(COALESCE(e."titulo", '')) = consulta.texto THEN 100.0 ELSE 0.0 END
        + CASE
            WHEN lower(COALESCE(e."titulo", '')) LIKE '%' || consulta.texto || '%'
            THEN 50.0
            ELSE 0.0
          END
        + CASE WHEN lower(COALESCE(e."tema", '')) = consulta.texto THEN 25.0 ELSE 0.0 END
      )::REAL AS score
    FROM "estampa" AS e
    CROSS JOIN consulta
    WHERE e."processing_status" = 'COMPLETED'
      AND e."is_active" = TRUE
      AND
      CASE
        WHEN consulta.codigo_variante IS NOT NULL THEN
          (
            lower(e."codigo") = consulta.codigo_variante[1]
            AND lower(COALESCE(e."variante", '')) = consulta.codigo_variante[2]
          )
          OR e."search_vector" @@ consulta.termos
        WHEN consulta.codigo_isolado IS NOT NULL THEN
          lower(e."codigo") = consulta.codigo_isolado
          OR e."search_vector" @@ consulta.termos
        ELSE e."search_vector" @@ consulta.termos
      END
  )
  SELECT
    jsonb_build_object(
      'id', resultados."id",
      'codigo', resultados."codigo",
      'variante', resultados."variante",
      'titulo', resultados."titulo",
      'descricao', resultados."descricao",
      'preview_url', resultados."preview_url",
      'cores', resultados."cores",
      'palavras_chave', resultados."palavras_chave"
    ) AS estampa,
    resultados.score AS relevancia
  FROM resultados
  ORDER BY
    resultados.score DESC,
    lower(COALESCE(resultados."variante", '')) ASC,
    resultados."updated_at" DESC,
    resultados."id" ASC
  LIMIT LEAST(GREATEST("p_limite", 1), 100)
  OFFSET GREATEST("p_offset", 0);
$$;

REVOKE ALL ON FUNCTION "buscar_estampas_por_relevancia"(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "buscar_estampas_por_relevancia"(TEXT, INTEGER, INTEGER)
TO authenticated, service_role;
