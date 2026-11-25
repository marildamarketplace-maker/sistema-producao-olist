-- Aplicação isolada após os consumidores compatíveis; nunca migrate deploy global.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.fornecedores
  ADD COLUMN ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN encerrado_em timestamptz;
CREATE INDEX idx_fornecedores_relacao_ativa
  ON public.fornecedores(aplicativo_id,aplicativo_pai_id,ativo);
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.fornecedores FROM PUBLIC,anon,authenticated;
DO $$ DECLARE coluna record; BEGIN
  FOR coluna IN SELECT attname FROM pg_attribute WHERE attrelid='public.fornecedores'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I),UPDATE (%I) ON public.fornecedores FROM PUBLIC,anon,authenticated',coluna.attname,coluna.attname);
  END LOOP;
END $$;

ALTER TABLE public.usuario_vendedor_olist
  ADD COLUMN origem_aplicativo_id uuid,
  ADD COLUMN fornecedor_matriz_id uuid,
  ADD COLUMN confirmado_em timestamptz,
  ADD COLUMN confirmado_por_id uuid,
  ADD COLUMN revogado_em timestamptz,
  ADD COLUMN motivo_revogacao text,
  ADD COLUMN revisao integer NOT NULL DEFAULT 1 CHECK (revisao > 0),
  ADD CONSTRAINT ck_vendedor_origem_externa CHECK (
    (origem_aplicativo_id IS NULL AND fornecedor_matriz_id IS NULL)
    OR (origem_aplicativo_id IS NOT NULL AND fornecedor_matriz_id IS NOT NULL
      AND confirmado_em IS NOT NULL AND confirmado_por_id IS NOT NULL)
  );
CREATE INDEX idx_usuario_vendedor_olist_relacao
  ON public.usuario_vendedor_olist(origem_aplicativo_id,fornecedor_matriz_id);
ALTER TABLE public.usuario_vendedor_olist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuario_vendedor_olist FROM PUBLIC,anon,authenticated;
DO $$ DECLARE coluna record; BEGIN
  FOR coluna IN SELECT attname FROM pg_attribute WHERE attrelid='public.usuario_vendedor_olist'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE SELECT (%I),INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.usuario_vendedor_olist FROM PUBLIC,anon,authenticated',
      coluna.attname,coluna.attname,coluna.attname,coluna.attname);
  END LOOP;
END $$;

-- A mesma chave existe mesmo sem linhas de fornecedor e independe de duplicados.
CREATE FUNCTION public.fornecedor_relacao_bloquear(cliente uuid, matriz uuid)
RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('fornecedor:'||cliente::text||':'||matriz::text,0))
$$;
REVOKE ALL ON FUNCTION public.fornecedor_relacao_bloquear(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fornecedor_relacao_validar() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE par record;
BEGIN
  -- A API adquire estes locks antes de tocar nas linhas. O trigger também cobre
  -- escritores internos; conflitos de ordem abortam a transação, nunca liberam acesso.
  FOR par IN
    SELECT cliente,matriz FROM (
      SELECT CASE WHEN TG_OP<>'INSERT' THEN OLD.aplicativo_id END AS cliente,
        CASE WHEN TG_OP<>'INSERT' THEN OLD.aplicativo_pai_id END AS matriz
      UNION SELECT CASE WHEN TG_OP<>'DELETE' THEN NEW.aplicativo_id END,
        CASE WHEN TG_OP<>'DELETE' THEN NEW.aplicativo_pai_id END
    ) p WHERE cliente IS NOT NULL AND matriz IS NOT NULL ORDER BY cliente,matriz
  LOOP
    PERFORM public.fornecedor_relacao_bloquear(par.cliente,par.matriz);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (NEW.aplicativo_id IS DISTINCT FROM OLD.aplicativo_id
    OR NEW.aplicativo_pai_id IS DISTINCT FROM OLD.aplicativo_pai_id)
    AND (EXISTS(SELECT 1 FROM public.pedido_fornecedor_queue WHERE fornecedor_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.pedido_fornecedor_solicitacao WHERE fornecedor_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.produtos_fornecedor WHERE fornecedor_id=OLD.id)) THEN
    RAISE EXCEPTION 'Encerre o fornecedor com histórico e cadastre o novo destino' USING ERRCODE='23514';
  END IF;
  IF NEW.ativo THEN NEW.encerrado_em=NULL;
  ELSE NEW.encerrado_em=COALESCE(NEW.encerrado_em,clock_timestamp()); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fornecedor_relacao_validar BEFORE INSERT OR UPDATE OR DELETE ON public.fornecedores
FOR EACH ROW EXECUTE FUNCTION public.fornecedor_relacao_validar();

CREATE FUNCTION public.fornecedor_relacao_revogar() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE pessoa record;
BEGIN
  IF TG_OP='INSERT' OR OLD.aplicativo_id IS NULL OR NOT OLD.ativo THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND NEW.ativo AND NEW.aplicativo_id=OLD.aplicativo_id
    AND NEW.aplicativo_pai_id=OLD.aplicativo_pai_id THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.fornecedores f WHERE f.aplicativo_id=OLD.aplicativo_id
      AND f.aplicativo_pai_id=OLD.aplicativo_pai_id AND f.ativo) THEN
    -- Ordem estável antes das atualizações que também versionam os usuários.
    FOR pessoa IN SELECT DISTINCT usuario_id FROM public.usuario_vendedor_olist
      WHERE origem_aplicativo_id=OLD.aplicativo_id AND fornecedor_matriz_id=OLD.aplicativo_pai_id
        AND revogado_em IS NULL ORDER BY usuario_id
    LOOP
      PERFORM 1 FROM public.usuario WHERE id=pessoa.usuario_id FOR UPDATE;
    END LOOP;
    UPDATE public.usuario_vendedor_olist SET revogado_em=clock_timestamp(),
      motivo_revogacao='RELACAO_FORNECEDOR_ENCERRADA'
      WHERE origem_aplicativo_id=OLD.aplicativo_id AND fornecedor_matriz_id=OLD.aplicativo_pai_id
        AND revogado_em IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER fornecedor_relacao_revogar AFTER UPDATE OR DELETE ON public.fornecedores
FOR EACH ROW EXECUTE FUNCTION public.fornecedor_relacao_revogar();

CREATE OR REPLACE FUNCTION public.usuario_vendedor_olist_validar() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE origem uuid; pai uuid; matriz uuid; versao integer;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.usuario_id<>OLD.usuario_id OR NEW.aplicativo_id<>OLD.aplicativo_id) THEN
    RAISE EXCEPTION 'A identidade do vínculo não pode ser alterada' USING ERRCODE='23514';
  END IF;
  -- A transição para revogado não depende de uma relação que acabou de terminar.
  IF TG_OP='UPDATE' AND NEW.revogado_em IS NOT NULL THEN
    IF NEW.vendedor_olist_id<>OLD.vendedor_olist_id
      OR NEW.origem_aplicativo_id IS DISTINCT FROM OLD.origem_aplicativo_id
      OR NEW.fornecedor_matriz_id IS DISTINCT FROM OLD.fornecedor_matriz_id
      OR NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
      OR NEW.confirmado_por_id IS DISTINCT FROM OLD.confirmado_por_id THEN
      RAISE EXCEPTION 'Revogar não pode alterar a identidade comercial' USING ERRCODE='23514';
    END IF;
    SELECT vinculos_olist_versao INTO versao FROM public.usuario WHERE id=NEW.usuario_id FOR UPDATE;
    NEW.revisao=GREATEST(OLD.revisao+1,versao+1); NEW.updated_at=clock_timestamp(); RETURN NEW;
  END IF;
  IF NEW.origem_aplicativo_id IS NOT NULL AND NEW.fornecedor_matriz_id IS NOT NULL THEN
    PERFORM public.fornecedor_relacao_bloquear(NEW.origem_aplicativo_id,NEW.fornecedor_matriz_id);
  END IF;
  SELECT aplicativo_id,vinculos_olist_versao INTO origem,versao FROM public.usuario WHERE id=NEW.usuario_id FOR UPDATE;
  SELECT aplicativo_pai_id INTO pai FROM public.aplicativo WHERE id=NEW.aplicativo_id FOR SHARE;
  IF origem IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'Usuário ou conta indisponível' USING ERRCODE='23514';
  END IF;
  matriz=COALESCE(pai,NEW.aplicativo_id);
  IF NEW.origem_aplicativo_id IS NOT NULL AND (NEW.aplicativo_id=origem OR pai=origem) THEN
    RAISE EXCEPTION 'A conta própria e os filhos diretos são administrados pelos vínculos internos' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.origem_aplicativo_id IS NULL AND NEW.origem_aplicativo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Vínculo interno não pode ser reinterpretado como externo' USING ERRCODE='23514';
  END IF;
  IF NEW.origem_aplicativo_id IS NULL AND NEW.fornecedor_matriz_id IS NULL THEN
    IF NEW.aplicativo_id<>origem AND pai IS DISTINCT FROM origem THEN
      RAISE EXCEPTION 'Vendedor deve pertencer ao aplicativo próprio ou filho direto' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.origem_aplicativo_id IS NOT NULL AND OLD.revogado_em IS NULL THEN
      RAISE EXCEPTION 'Vínculo externo não pode ser reinterpretado como interno' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.origem_aplicativo_id IS DISTINCT FROM origem
      OR NEW.fornecedor_matriz_id IS DISTINCT FROM matriz
      OR NEW.confirmado_em IS NULL OR NEW.confirmado_por_id IS NULL
      OR NOT EXISTS(SELECT 1 FROM public.aplicativo WHERE id=matriz AND aplicativo_pai_id IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.fornecedores WHERE aplicativo_id=origem
        AND aplicativo_pai_id=matriz AND ativo) THEN
    RAISE EXCEPTION 'Vínculo externo exige relação ativa e confirmação válida' USING ERRCODE='23514';
  END IF;
  NEW.motivo_revogacao=NULL;
  -- O contador do usuário sobrevive ao DELETE nativo. Um INSERT posterior não
  -- pode reutilizar a revisão de uma captura/prévia anterior da mesma chave.
  -- AFTER versionar avança o contador também em lotes e em exclusões; OLD cobre
  -- a revisão inicial 1 de vínculos legados cujo contador ainda começa em 0.
  NEW.revisao=CASE WHEN TG_OP='UPDATE' THEN GREATEST(OLD.revisao+1,versao+1) ELSE versao+1 END;
  NEW.updated_at=clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.usuario_vendedor_olist_proteger_usuario() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.aplicativo_id IS DISTINCT FROM OLD.aplicativo_id THEN
    IF COALESCE(to_jsonb(OLD)->>'vendedor_olist_id','')<>'' THEN
      RAISE EXCEPTION 'Limpe o vendedor legado antes de mudar o aplicativo do usuário' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.usuario_vendedor_olist v JOIN public.aplicativo a ON a.id=v.aplicativo_id
      WHERE v.usuario_id=NEW.id AND v.revogado_em IS NULL AND (
        v.origem_aplicativo_id IS NOT NULL OR (a.id<>NEW.aplicativo_id AND a.aplicativo_pai_id IS DISTINCT FROM NEW.aplicativo_id))) THEN
      RAISE EXCEPTION 'Remova vínculos incompatíveis ou revogue os externos antes de mudar o aplicativo do usuário' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.usuario_vendedor_olist_proteger_aplicativo() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.aplicativo_pai_id IS DISTINCT FROM OLD.aplicativo_pai_id AND EXISTS(
    SELECT 1 FROM public.usuario_vendedor_olist v JOIN public.usuario u ON u.id=v.usuario_id
    WHERE v.revogado_em IS NULL AND (v.aplicativo_id=NEW.id OR v.fornecedor_matriz_id=NEW.id)
      AND (v.origem_aplicativo_id IS NOT NULL OR
        (u.aplicativo_id<>NEW.id AND u.aplicativo_id IS DISTINCT FROM NEW.aplicativo_pai_id))) THEN
    RAISE EXCEPTION 'Remova vínculos incompatíveis ou revogue os externos antes de mudar o aplicativo pai' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE public.pedido_fornecedor_queue DROP CONSTRAINT ck_fila_origem;
ALTER TABLE public.pedido_fornecedor_queue ADD CONSTRAINT ck_fila_origem CHECK(
  (tipo_origem='PRODUCAO' AND solicitacao_producao_id IS NOT NULL AND fornecedor_id IS NOT NULL)
  OR (tipo_origem='MANUAL' AND solicitacao_producao_id IS NULL AND autor_id IS NOT NULL
    AND chave_idempotencia IS NOT NULL AND hash_entrada IS NOT NULL
    AND ((fornecedor_id IS NULL AND aplicativo_solicitante_id=aplicativo_fornecedor_id)
      OR (fornecedor_id IS NOT NULL AND aplicativo_solicitante_id<>aplicativo_fornecedor_id)))
);

CREATE FUNCTION public.fila_manual_fornecedor_validar() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE cliente uuid; matriz uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.tipo_origem='MANUAL' AND OLD.fornecedor_id IS NOT NULL
    AND (NEW.tipo_origem IS DISTINCT FROM OLD.tipo_origem
    OR NEW.aplicativo_solicitante_id IS DISTINCT FROM OLD.aplicativo_solicitante_id
    OR NEW.aplicativo_fornecedor_id IS DISTINCT FROM OLD.aplicativo_fornecedor_id
    OR NEW.fornecedor_id IS DISTINCT FROM OLD.fornecedor_id OR NEW.autor_id IS DISTINCT FROM OLD.autor_id) THEN
    RAISE EXCEPTION 'A origem do pedido manual não pode ser alterada' USING ERRCODE='23514';
  END IF;
  IF NEW.tipo_origem<>'MANUAL' OR NEW.fornecedor_id IS NULL THEN RETURN NEW; END IF;
  SELECT aplicativo_id,aplicativo_pai_id INTO cliente,matriz FROM public.fornecedores WHERE id=NEW.fornecedor_id;
  IF NOT FOUND OR cliente IS DISTINCT FROM NEW.aplicativo_solicitante_id
    OR matriz IS DISTINCT FROM NEW.aplicativo_fornecedor_id THEN
    RAISE EXCEPTION 'Fornecedor não corresponde à origem e matriz da fila' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.fornecedor_relacao_bloquear(cliente,matriz);
    IF NOT EXISTS(SELECT 1 FROM public.fornecedores WHERE aplicativo_id=cliente AND aplicativo_pai_id=matriz AND ativo)
      OR NOT EXISTS(SELECT 1 FROM public.usuario WHERE id=NEW.autor_id AND aplicativo_id=cliente AND ativo) THEN
      RAISE EXCEPTION 'Origem do pedido manual não está autorizada' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fila_manual_fornecedor_validar BEFORE INSERT OR UPDATE ON public.pedido_fornecedor_queue
FOR EACH ROW EXECUTE FUNCTION public.fila_manual_fornecedor_validar();

REVOKE ALL ON FUNCTION public.fornecedor_relacao_validar(),public.fornecedor_relacao_revogar(),
  public.fila_manual_fornecedor_validar() FROM PUBLIC,anon,authenticated;
COMMIT;
