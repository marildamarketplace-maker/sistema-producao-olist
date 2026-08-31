BEGIN;

ALTER TABLE public.estampas
  ADD COLUMN IF NOT EXISTS publicos_sugeridos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS contextos_uso TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS afinidades_visuais TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS confianca_segmentacao DOUBLE PRECISION;

ALTER TABLE public.estampas
  DROP CONSTRAINT IF EXISTS estampas_confianca_segmentacao_check,
  ADD CONSTRAINT estampas_confianca_segmentacao_check
    CHECK (confianca_segmentacao IS NULL OR confianca_segmentacao BETWEEN 0 AND 1),
  DROP CONSTRAINT IF EXISTS estampas_publicos_sugeridos_check,
  ADD CONSTRAINT estampas_publicos_sugeridos_check CHECK (
    publicos_sugeridos <@ ARRAY['geral', 'infantil', 'juvenil', 'adulto', 'familiar']::TEXT[]
  ),
  DROP CONSTRAINT IF EXISTS estampas_contextos_uso_check,
  ADD CONSTRAINT estampas_contextos_uso_check CHECK (
    contextos_uso <@ ARRAY[
      'decoração', 'festas e eventos', 'campanhas de conscientização',
      'ambiente escolar', 'contexto religioso ou devocional',
      'eventos esportivos', 'uso corporativo'
    ]::TEXT[]
  ),
  DROP CONSTRAINT IF EXISTS estampas_afinidades_visuais_check,
  ADD CONSTRAINT estampas_afinidades_visuais_check CHECK (
    afinidades_visuais <@ ARRAY[
      'delicado', 'romântico', 'country', 'rústico', 'geek', 'esportivo',
      'clássico', 'lúdico'
    ]::TEXT[]
  );

CREATE INDEX IF NOT EXISTS estampas_publicos_sugeridos_gin
  ON public.estampas USING GIN (publicos_sugeridos);
CREATE INDEX IF NOT EXISTS estampas_contextos_uso_gin
  ON public.estampas USING GIN (contextos_uso);
CREATE INDEX IF NOT EXISTS estampas_afinidades_visuais_gin
  ON public.estampas USING GIN (afinidades_visuais);

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
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS estampas_normalizar_taxonomias_trigger ON public.estampas;
CREATE TRIGGER estampas_normalizar_taxonomias_trigger
BEFORE INSERT OR UPDATE OF tema, estilo, subtemas, palavras_chave, cores,
  elementos_visuais, ocasioes, categorias, publicos_sugeridos, contextos_uso,
  afinidades_visuais
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
  publicos_sugeridos, contextos_uso, afinidades_visuais
ON public.estampas
FOR EACH ROW
EXECUTE FUNCTION public.estampas_atualizar_search_vector();

-- A inclusão dos campos não agenda reprocessamento nem altera status/updated_at.
LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.estampas DISABLE TRIGGER estampas_preservar_estado_ia_trigger;
UPDATE public.estampas SET titulo = titulo;
ALTER TABLE public.estampas ENABLE TRIGGER estampas_preservar_estado_ia_trigger;

COMMIT;
