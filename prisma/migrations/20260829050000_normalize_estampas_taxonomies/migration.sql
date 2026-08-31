BEGIN;

CREATE OR REPLACE FUNCTION public.estampas_normalizar_taxonomia_texto(valor TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT NULLIF(lower(regexp_replace(btrim(valor), '\s+', ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.estampas_normalizar_taxonomia_lista(lista TEXT[])
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(array_agg(item.valor ORDER BY item.primeira_posicao), ARRAY[]::TEXT[])
  FROM (
    SELECT
      public.estampas_normalizar_taxonomia_texto(valor) AS valor,
      min(posicao) AS primeira_posicao
    FROM unnest(COALESCE(lista, ARRAY[]::TEXT[])) WITH ORDINALITY AS entrada(valor, posicao)
    WHERE public.estampas_normalizar_taxonomia_texto(valor) IS NOT NULL
    GROUP BY public.estampas_normalizar_taxonomia_texto(valor)
  ) AS item;
$function$;

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
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS estampas_normalizar_taxonomias_trigger ON public.estampas;
CREATE TRIGGER estampas_normalizar_taxonomias_trigger
BEFORE INSERT OR UPDATE OF tema, estilo, subtemas, palavras_chave, cores,
  elementos_visuais, ocasioes, categorias
ON public.estampas
FOR EACH ROW
EXECUTE FUNCTION public.estampas_normalizar_taxonomias();

-- Padroniza o histórico sem alterar status ou updated_at.
LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.estampas DISABLE TRIGGER estampas_preservar_estado_ia_trigger;
UPDATE public.estampas
SET
  tema = public.estampas_normalizar_taxonomia_texto(tema),
  estilo = public.estampas_normalizar_taxonomia_texto(estilo),
  subtemas = public.estampas_normalizar_taxonomia_lista(subtemas),
  palavras_chave = public.estampas_normalizar_taxonomia_lista(palavras_chave),
  cores = public.estampas_normalizar_taxonomia_lista(cores),
  elementos_visuais = public.estampas_normalizar_taxonomia_lista(elementos_visuais),
  ocasioes = public.estampas_normalizar_taxonomia_lista(ocasioes),
  categorias = public.estampas_normalizar_taxonomia_lista(categorias)
WHERE
  tema IS DISTINCT FROM public.estampas_normalizar_taxonomia_texto(tema)
  OR estilo IS DISTINCT FROM public.estampas_normalizar_taxonomia_texto(estilo)
  OR subtemas IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(subtemas)
  OR palavras_chave IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(palavras_chave)
  OR cores IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(cores)
  OR elementos_visuais IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(elementos_visuais)
  OR ocasioes IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(ocasioes)
  OR categorias IS DISTINCT FROM public.estampas_normalizar_taxonomia_lista(categorias);
ALTER TABLE public.estampas ENABLE TRIGGER estampas_preservar_estado_ia_trigger;

COMMIT;
