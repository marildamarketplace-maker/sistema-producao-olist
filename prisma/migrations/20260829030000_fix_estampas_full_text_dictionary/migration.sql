BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

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
        setweight(to_tsvector('simple', extensions.unaccent(COALESCE(NEW.texto_pesquisa, ''))), 'D');
    RETURN NEW;
END;
$function$;

-- A reconstrução não deve alterar status nem updated_at das estampas.
LOCK TABLE public.estampas IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.estampas DISABLE TRIGGER estampas_preservar_estado_ia_trigger;
UPDATE public.estampas SET titulo = titulo;
ALTER TABLE public.estampas ENABLE TRIGGER estampas_preservar_estado_ia_trigger;

COMMIT;
