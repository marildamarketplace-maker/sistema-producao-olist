BEGIN;

ALTER TABLE public.estampas
  ADD COLUMN IF NOT EXISTS padroes_texteis TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS confianca_padrao_textil DOUBLE PRECISION;

ALTER TABLE public.estampas
  DROP CONSTRAINT IF EXISTS estampas_confianca_padrao_textil_check,
  ADD CONSTRAINT estampas_confianca_padrao_textil_check
    CHECK (confianca_padrao_textil IS NULL OR confianca_padrao_textil BETWEEN 0 AND 1),
  DROP CONSTRAINT IF EXISTS estampas_padroes_texteis_check,
  ADD CONSTRAINT estampas_padroes_texteis_check CHECK (
    padroes_texteis <@ ARRAY[
      'poá', 'floral', 'folhagem', 'tropical', 'listrado', 'xadrez', 'vichy',
      'pied-de-poule', 'chevron', 'zigue-zague', 'geométrico', 'abstrato',
      'paisley', 'arabesco', 'damasco', 'animal print', 'camuflado', 'tie-dye',
      'patchwork', 'étnico', 'mandala'
    ]::TEXT[]
  );

CREATE INDEX IF NOT EXISTS estampas_padroes_texteis_gin
  ON public.estampas USING GIN (padroes_texteis);

CREATE OR REPLACE FUNCTION public.estampas_normalizar_taxonomias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.tema := public.estampas_normalizar_taxonomia_texto(NEW.tema);
  NEW.estilo := public.estampas_normalizar_taxonomia_texto(NEW.estilo);
  NEW.subtemas := public.estampas_normalizar_taxonomia_lista(NEW.subtemas);
  NEW.palavras_chave := public.estampas_normalizar_taxonomia_lista(NEW.palavras_chave);
  NEW.cores := public.estampas_normalizar_taxonomia_lista(NEW.cores);
  NEW.elementos_visuais := public.estampas_normalizar_taxonomia_lista(NEW.elementos_visuais);
  NEW.ocasioes := public.estampas_normalizar_taxonomia_lista(NEW.ocasioes);
  NEW.categorias := public.estampas_normalizar_taxonomia_lista(NEW.categorias);
  NEW.publicos_sugeridos := public.estampas_normalizar_taxonomia_lista(NEW.publicos_sugeridos);
  NEW.contextos_uso := public.estampas_normalizar_taxonomia_lista(NEW.contextos_uso);
  NEW.afinidades_visuais := public.estampas_normalizar_taxonomia_lista(NEW.afinidades_visuais);
  NEW.padroes_texteis := public.estampas_normalizar_taxonomia_lista(NEW.padroes_texteis);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS estampas_normalizar_taxonomias_trigger ON public.estampas;
CREATE TRIGGER estampas_normalizar_taxonomias_trigger
BEFORE INSERT OR UPDATE OF tema, estilo, subtemas, palavras_chave, cores,
  elementos_visuais, ocasioes, categorias, publicos_sugeridos, contextos_uso,
  afinidades_visuais, padroes_texteis
ON public.estampas
FOR EACH ROW
EXECUTE FUNCTION public.estampas_normalizar_taxonomias();

CREATE OR REPLACE FUNCTION public.estampas_atualizar_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.codigo, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.variante, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.titulo, ''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.tema, ''))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(NEW.padroes_texteis, ' '))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.descricao, ''))), 'C') ||
    setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.texto_pesquisa, ''))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(NEW.publicos_sugeridos, ' '))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(NEW.contextos_uso, ' '))), 'D') ||
    setweight(to_tsvector('simple', extensions.unaccent(array_to_string(NEW.afinidades_visuais, ' '))), 'D');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS estampas_atualizar_search_vector_trigger ON public.estampas;
CREATE TRIGGER estampas_atualizar_search_vector_trigger
BEFORE INSERT OR UPDATE OF codigo, variante, titulo, tema, descricao, texto_pesquisa,
  publicos_sugeridos, contextos_uso, afinidades_visuais, padroes_texteis
ON public.estampas
FOR EACH ROW
EXECUTE FUNCTION public.estampas_atualizar_search_vector();

-- Backfill conservador, baseado somente nos metadados já existentes. Não chama IA.
LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.estampas DISABLE TRIGGER estampas_preservar_estado_ia_trigger;
WITH candidatos AS (
  SELECT
    id,
    lower(extensions.unaccent(concat_ws(' ',
      titulo,
      descricao,
      tema,
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
       texto ~ '(^|[^[:alnum:]])pontos?([^[:alnum:]]|$)'
       AND texto ~ '(^|[^[:alnum:]])padrao([^[:alnum:]]|$)'
       AND texto ~ '(^|[^[:alnum:]])geometrico([^[:alnum:]]|$)'
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
      'version', 'textile-taxonomy-v1',
      'source', 'existing_metadata',
      'pattern', 'poá'
    )
  )
FROM poas
WHERE e.id = poas.id;
ALTER TABLE public.estampas ENABLE TRIGGER estampas_preservar_estado_ia_trigger;

COMMIT;
