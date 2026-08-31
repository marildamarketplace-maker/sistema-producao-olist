BEGIN;

LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.estampas DISABLE TRIGGER estampas_preservar_estado_ia_trigger;

WITH candidatos AS (
  SELECT
    id,
    lower(extensions.unaccent(COALESCE(titulo, ''))) AS titulo,
    lower(extensions.unaccent(COALESCE(tema, ''))) AS tema,
    lower(extensions.unaccent(concat_ws(' ',
      titulo,
      descricao,
      texto_pesquisa,
      array_to_string(palavras_chave, ' '),
      array_to_string(elementos_visuais, ' ')
    ))) AS texto
  FROM public.estampas
), poas AS (
  SELECT id
  FROM candidatos
  WHERE texto ~ '(^|[^[:alnum:]])(poas?|bolinhas?|polka[[:space:]]+dots?)([^[:alnum:]]|$)'
     OR (
       titulo ~ '(^|[^[:alnum:]])estampa([^[:alnum:]]|$).*(^|[^[:alnum:]])pontos?([^[:alnum:]]|$)'
       AND tema = 'geometrico'
     )
)
UPDATE public.estampas AS e
SET
  padroes_texteis = CASE
    WHEN e.padroes_texteis @> ARRAY['poá']::TEXT[] THEN e.padroes_texteis
    ELSE array_append(e.padroes_texteis, 'poá')
  END,
  confianca_padrao_textil = GREATEST(COALESCE(e.confianca_padrao_textil, 0), 0.9),
  texto_pesquisa = CASE
    WHEN lower(extensions.unaccent(COALESCE(e.texto_pesquisa, ''))) ~ '(^|[^[:alnum:]])poa([^[:alnum:]]|$)'
      THEN e.texto_pesquisa
    ELSE concat_ws(' ', NULLIF(btrim(e.texto_pesquisa), ''), 'poá')
  END,
  ai_metadata = COALESCE(e.ai_metadata, '{}'::JSONB) || jsonb_build_object(
    'textile_taxonomy_backfill', jsonb_build_object(
      'version', 'textile-taxonomy-v1.1',
      'source', 'existing_metadata',
      'pattern', 'poá'
    )
  )
FROM poas
WHERE e.id = poas.id;

ALTER TABLE public.estampas ENABLE TRIGGER estampas_preservar_estado_ia_trigger;
COMMIT;
