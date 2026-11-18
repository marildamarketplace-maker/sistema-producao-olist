-- Aplicar isoladamente após revisão. Não habilita jobs nem inventa watermarks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE olist_sync_estado
 ADD COLUMN presente boolean NOT NULL DEFAULT true,
 ADD COLUMN detalhe_pendente boolean NOT NULL DEFAULT false,
 ADD COLUMN fingerprint text,
 ADD COLUMN ultima_listagem_execucao_id uuid REFERENCES olist_sync_execucao(id) ON DELETE SET NULL,
 ADD COLUMN ultima_completa_execucao_id uuid REFERENCES olist_sync_execucao(id) ON DELETE SET NULL;
CREATE INDEX olist_sync_estado_coleta_pendente_idx ON olist_sync_estado(configuracao_id,entidade,ultima_listagem_execucao_id,detalhe_pendente,id);
CREATE INDEX olist_sync_estado_detalhe_pendente_idx ON olist_sync_estado(configuracao_id,aplicativo_id,entidade,id) WHERE detalhe_pendente=true;
CREATE UNIQUE INDEX olist_sync_execucao_id_configuracao_id_key ON olist_sync_execucao(id,configuracao_id);

CREATE TABLE olist_sync_cobertura (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 configuracao_id uuid NOT NULL REFERENCES olist_sync_configuracao(id) ON DELETE RESTRICT,
 aplicativo_id uuid NOT NULL,
 entidade text NOT NULL CHECK (entidade IN ('PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR')),
 conta_identidade text,
 assinatura_escopo text NOT NULL DEFAULT '',
 versao_contrato integer NOT NULL DEFAULT 1 CHECK (versao_contrato>0),
 completa_execucao_id uuid REFERENCES olist_sync_execucao(id) ON DELETE SET NULL,
 completa_iniciada_em timestamptz,
 completa_em timestamptz,
 watermark_confirmado timestamptz,
 incremental_em timestamptz,
 ultima_execucao_id uuid REFERENCES olist_sync_execucao(id) ON DELETE SET NULL,
 geracao integer NOT NULL DEFAULT 0 CHECK (geracao>=0),
 incremental_validado boolean NOT NULL DEFAULT false,
 incremental_fuso text,
 incremental_conta_identidade text,
 incremental_validado_em timestamptz,
 incremental_validado_por uuid,
 incremental_versao_contrato integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT olist_sync_cobertura_configuracao_id_aplicativo_id_entidade_key UNIQUE(configuracao_id,aplicativo_id,entidade),
 CONSTRAINT olist_sync_cobertura_participante_fkey FOREIGN KEY(configuracao_id,aplicativo_id) REFERENCES olist_sync_participante(configuracao_id,aplicativo_id) ON DELETE RESTRICT,
 CONSTRAINT olist_sync_cobertura_validacao CHECK (NOT incremental_validado OR (incremental_fuso IS NOT NULL AND incremental_conta_identidade IS NOT NULL AND incremental_validado_em IS NOT NULL AND incremental_validado_por IS NOT NULL AND incremental_versao_contrato IS NOT NULL)),
 CONSTRAINT olist_sync_cobertura_base CHECK (watermark_confirmado IS NULL OR (completa_iniciada_em IS NOT NULL AND completa_em IS NOT NULL AND conta_identidade IS NOT NULL AND assinatura_escopo<>''))
);

CREATE TABLE olist_sync_afetado (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 configuracao_id uuid NOT NULL REFERENCES olist_sync_configuracao(id) ON DELETE RESTRICT,
 execucao_id uuid NOT NULL,
 entidade text NOT NULL CHECK (entidade IN ('PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR')),
 registro_id uuid NOT NULL,
 identidade_alterada boolean NOT NULL DEFAULT false,
 processado_em timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT olist_sync_afetado_execucao_fkey FOREIGN KEY(execucao_id,configuracao_id) REFERENCES olist_sync_execucao(id,configuracao_id) ON DELETE RESTRICT,
 CONSTRAINT olist_sync_afetado_registro_fkey FOREIGN KEY(registro_id,configuracao_id) REFERENCES olist_sync_registro(id,configuracao_id) ON DELETE RESTRICT,
 CONSTRAINT olist_sync_afetado_execucao_id_entidade_registro_id_key UNIQUE(execucao_id,entidade,registro_id)
);
CREATE INDEX olist_sync_afetado_pendente_idx ON olist_sync_afetado(configuracao_id,entidade,processado_em,registro_id);

-- A entidade da fila também pertence ao registro; IDs de outro grupo falham nas FKs.
CREATE FUNCTION olist_sync_validar_afetado() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.olist_sync_registro WHERE id=NEW.registro_id AND configuracao_id=NEW.configuracao_id AND entidade=NEW.entidade) THEN
  RAISE EXCEPTION 'Registro afetado fora do escopo' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER olist_sync_validar_afetado BEFORE INSERT OR UPDATE OF configuracao_id,registro_id,entidade ON olist_sync_afetado FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_afetado();
REVOKE ALL ON FUNCTION olist_sync_validar_afetado() FROM PUBLIC;

ALTER TABLE olist_sync_cobertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE olist_sync_afetado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON olist_sync_cobertura,olist_sync_afetado FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.olist_sync_cobertura,public.olist_sync_afetado FROM %I',r); END IF;
 END LOOP;
END $$;
COMMIT;
