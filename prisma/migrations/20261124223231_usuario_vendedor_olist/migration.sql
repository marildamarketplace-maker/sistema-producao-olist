-- Expansão isolada. Não executar migrate deploy global: consulte docs/vendedor-olist-multiempresa.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.usuario ADD COLUMN vinculos_olist_versao integer NOT NULL DEFAULT 0
  CHECK (vinculos_olist_versao >= 0);

CREATE TABLE public.usuario_vendedor_olist (
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  aplicativo_id uuid NOT NULL REFERENCES public.aplicativo(id) ON DELETE CASCADE,
  vendedor_olist_id integer NOT NULL CHECK (vendedor_olist_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, aplicativo_id)
);
CREATE INDEX idx_usuario_vendedor_olist_conta_vendedor
  ON public.usuario_vendedor_olist(aplicativo_id,vendedor_olist_id);
ALTER TABLE public.usuario_vendedor_olist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.usuario_vendedor_olist FROM PUBLIC,anon,authenticated;

-- Qualquer ID inválido aborta a migração; não corrigir/copiar IDs entre contas.
INSERT INTO public.usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id)
SELECT id,aplicativo_id,vendedor_olist_id FROM public.usuario WHERE vendedor_olist_id IS NOT NULL;

CREATE FUNCTION public.usuario_vendedor_olist_validar() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public AS $$
DECLARE origem uuid; pai uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.usuario_id<>OLD.usuario_id OR NEW.aplicativo_id<>OLD.aplicativo_id) THEN
    RAISE EXCEPTION 'A identidade do vínculo não pode ser alterada' USING ERRCODE='23514';
  END IF;
  SELECT aplicativo_id INTO origem FROM public.usuario WHERE id=NEW.usuario_id FOR UPDATE;
  SELECT aplicativo_pai_id INTO pai FROM public.aplicativo WHERE id=NEW.aplicativo_id FOR SHARE;
  IF origem IS NULL OR NOT FOUND OR (NEW.aplicativo_id<>origem AND pai IS DISTINCT FROM origem) THEN
    RAISE EXCEPTION 'Vendedor deve pertencer ao aplicativo próprio ou filho direto' USING ERRCODE='23514';
  END IF;
  NEW.updated_at=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_vendedor_olist_validar BEFORE INSERT OR UPDATE ON public.usuario_vendedor_olist
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_validar();

CREATE FUNCTION public.usuario_vendedor_olist_versionar() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    UPDATE public.usuario SET vinculos_olist_versao=vinculos_olist_versao+1 WHERE id=OLD.usuario_id;
    RETURN OLD;
  END IF;
  UPDATE public.usuario SET vinculos_olist_versao=vinculos_olist_versao+1 WHERE id=NEW.usuario_id;
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_vendedor_olist_versionar AFTER INSERT OR UPDATE OR DELETE ON public.usuario_vendedor_olist
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_versionar();

CREATE FUNCTION public.usuario_vendedor_olist_proteger_usuario() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public AS $$
BEGIN
  -- O escalar legado nunca pode ser reinterpretado em outra conta. A consulta
  -- JSON também funciona após a contração, quando essa coluna deixa de existir.
  IF NEW.aplicativo_id IS DISTINCT FROM OLD.aplicativo_id AND
     COALESCE(to_jsonb(OLD)->>'vendedor_olist_id','')<>'' THEN
    RAISE EXCEPTION 'Limpe o vendedor legado antes de mudar o aplicativo do usuário' USING ERRCODE='23514';
  END IF;
  IF NEW.aplicativo_id IS DISTINCT FROM OLD.aplicativo_id AND EXISTS (
    SELECT 1 FROM public.usuario_vendedor_olist v JOIN public.aplicativo a ON a.id=v.aplicativo_id
    WHERE v.usuario_id=NEW.id AND a.id<>NEW.aplicativo_id AND a.aplicativo_pai_id IS DISTINCT FROM NEW.aplicativo_id
  ) THEN
    RAISE EXCEPTION 'Remova vínculos incompatíveis antes de mudar o aplicativo do usuário' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_vendedor_olist_proteger_usuario BEFORE UPDATE OF aplicativo_id ON public.usuario
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_proteger_usuario();

CREATE FUNCTION public.usuario_vendedor_olist_proteger_aplicativo() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public AS $$
BEGIN
  IF NEW.aplicativo_pai_id IS DISTINCT FROM OLD.aplicativo_pai_id AND EXISTS (
    SELECT 1 FROM public.usuario_vendedor_olist v JOIN public.usuario u ON u.id=v.usuario_id
    WHERE v.aplicativo_id=NEW.id AND u.aplicativo_id<>NEW.id AND u.aplicativo_id IS DISTINCT FROM NEW.aplicativo_pai_id
  ) THEN
    RAISE EXCEPTION 'Remova vínculos incompatíveis antes de mudar o aplicativo pai' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_vendedor_olist_proteger_aplicativo BEFORE UPDATE OF aplicativo_pai_id ON public.aplicativo
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_proteger_aplicativo();

-- Ponte de escrita temporária: versões antigas só modificam a linha própria.
CREATE FUNCTION public.usuario_vendedor_olist_ponte_legada() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,public AS $$
BEGIN
  IF NEW.vendedor_olist_id IS NULL THEN
    DELETE FROM public.usuario_vendedor_olist WHERE usuario_id=NEW.id AND aplicativo_id=NEW.aplicativo_id;
  ELSE
    INSERT INTO public.usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id)
    VALUES(NEW.id,NEW.aplicativo_id,NEW.vendedor_olist_id)
    ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_vendedor_olist_ponte_insert AFTER INSERT ON public.usuario
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_ponte_legada();
CREATE TRIGGER usuario_vendedor_olist_ponte_update AFTER UPDATE OF vendedor_olist_id ON public.usuario
  FOR EACH ROW EXECUTE FUNCTION public.usuario_vendedor_olist_ponte_legada();

REVOKE ALL ON FUNCTION public.usuario_vendedor_olist_validar(),public.usuario_vendedor_olist_versionar(),
  public.usuario_vendedor_olist_proteger_usuario(),public.usuario_vendedor_olist_proteger_aplicativo(),
  public.usuario_vendedor_olist_ponte_legada() FROM PUBLIC,anon,authenticated;
COMMIT;
