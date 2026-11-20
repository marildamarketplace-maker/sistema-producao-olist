BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

CREATE TABLE ia_configuracao (
  aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), tipo text NOT NULL,
  prompt text NOT NULL CHECK(octet_length(prompt)<=32000), revisao integer NOT NULL CHECK(revisao>0),
  atualizado_por uuid NOT NULL, atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(aplicativo_id,tipo)
);
CREATE TABLE ia_worker (
  id text PRIMARY KEY, aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), grupo text NOT NULL,
  protocolo integer NOT NULL, tipos text[] NOT NULL, contato_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ia_worker_disponibilidade ON ia_worker(aplicativo_id,contato_em);
CREATE TABLE ia_trabalho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),
  solicitado_por uuid NOT NULL, tipo text NOT NULL, origem_id uuid NOT NULL, chave uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY','FALHOU','CANCELADO','CONCLUIDO')),
  fase text NOT NULL DEFAULT 'PREPARAR' CHECK(fase IN ('PREPARAR','GERAR','REVISAR','PUBLICAR')),
  prompt_geracao text NOT NULL, prompt_revisao text NOT NULL, prompt_personalizado text NOT NULL, revisao_config integer NOT NULL,
  cursor text, total integer NOT NULL DEFAULT 0 CHECK(total>=0), processados integer NOT NULL DEFAULT 0 CHECK(processados>=0 AND processados<=total),
  total_lotes integer NOT NULL DEFAULT 0, lote_atual integer NOT NULL DEFAULT 0,
  tentativas integer NOT NULL DEFAULT 0, erro text,
  reserva uuid, reserva_ate timestamptz, worker text, grupo text,
  disponivel_em timestamptz NOT NULL DEFAULT now(), criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(), finalizado_em timestamptz,
  UNIQUE(aplicativo_id,solicitado_por,chave), UNIQUE(id,aplicativo_id),
  CHECK ((status='PROCESSANDO')=(reserva IS NOT NULL AND reserva_ate IS NOT NULL AND worker IS NOT NULL AND grupo IS NOT NULL))
);
CREATE UNIQUE INDEX ia_trabalho_origem_ativa ON ia_trabalho(aplicativo_id,tipo,origem_id)
  WHERE status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY');
CREATE INDEX ia_trabalho_fila ON ia_trabalho(aplicativo_id,disponivel_em,criado_em,id)
  WHERE status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY');
CREATE INDEX ia_trabalho_reservas ON ia_trabalho(grupo,reserva_ate) WHERE status='PROCESSANDO';
CREATE INDEX ia_trabalho_historico ON ia_trabalho(aplicativo_id,tipo,origem_id,criado_em DESC,id);
CREATE TABLE ia_lote (
  trabalho_id uuid NOT NULL, aplicativo_id uuid NOT NULL, numero integer NOT NULL CHECK(numero>=0),
  entrada jsonb NOT NULL CHECK(jsonb_typeof(entrada)='array' AND octet_length(entrada::text)<=131072),
  candidato jsonb, revisado jsonb, resultado jsonb,
  PRIMARY KEY(trabalho_id,numero),
  FOREIGN KEY(trabalho_id,aplicativo_id) REFERENCES ia_trabalho(id,aplicativo_id) ON DELETE CASCADE,
  CHECK(resultado IS NULL OR (candidato IS NOT NULL AND revisado IS NOT NULL))
);
CREATE TABLE ia_tentativa (
  id uuid PRIMARY KEY, trabalho_id uuid NOT NULL REFERENCES ia_trabalho(id) ON DELETE CASCADE,
  worker text NOT NULL, fase text NOT NULL, lote integer NOT NULL, status text NOT NULL DEFAULT 'PROCESSANDO',
  iniciada_em timestamptz NOT NULL DEFAULT now(), finalizada_em timestamptz, codigo text
);
CREATE INDEX ia_tentativa_trabalho ON ia_tentativa(trabalho_id,iniciada_em);
CREATE INDEX itens_busca_sku_ia_pagina ON itens_busca_sku(aplicativo_id,busca_id,sku,pedido_olist_id);
CREATE UNIQUE INDEX buscas_sku_id_aplicativo_ia ON buscas_sku(id,aplicativo_id);
CREATE TABLE ia_relatorio_busca (
  trabalho_id uuid PRIMARY KEY, aplicativo_id uuid NOT NULL, busca_id uuid NOT NULL,
  UNIQUE(trabalho_id,aplicativo_id),
  FOREIGN KEY(trabalho_id,aplicativo_id) REFERENCES ia_trabalho(id,aplicativo_id) ON DELETE CASCADE,
  FOREIGN KEY(busca_id,aplicativo_id) REFERENCES buscas_sku(id,aplicativo_id) ON DELETE CASCADE
);
CREATE INDEX ia_relatorio_busca_origem ON ia_relatorio_busca(aplicativo_id,busca_id);

-- Impede publicação órfã e protege também exclusões feitas fora da API.
CREATE FUNCTION proteger_relatorio_ia_busca() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM ia_relatorio_busca r JOIN ia_trabalho t ON t.id=r.trabalho_id
    WHERE r.busca_id=OLD.id AND r.aplicativo_id=OLD.aplicativo_id AND t.status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY')) THEN
    RAISE EXCEPTION 'RELATORIO_IA_ATIVO';
  END IF;
  DELETE FROM ia_trabalho WHERE id IN (SELECT trabalho_id FROM ia_relatorio_busca WHERE busca_id=OLD.id AND aplicativo_id=OLD.aplicativo_id);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION proteger_relatorio_ia_busca() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER busca_sku_proteger_relatorio_ia BEFORE DELETE ON buscas_sku FOR EACH ROW EXECUTE FUNCTION proteger_relatorio_ia_busca();

ALTER TABLE ia_configuracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_trabalho ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_tentativa ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_relatorio_busca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ia_configuracao,ia_worker,ia_trabalho,ia_lote,ia_tentativa,ia_relatorio_busca FROM anon,authenticated;
COMMIT;
