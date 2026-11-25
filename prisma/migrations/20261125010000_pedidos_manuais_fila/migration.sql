BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- A criação MANUAL só é habilitada depois de todos os consumidores atualizados.
ALTER TABLE pedido_fornecedor_queue
  ALTER COLUMN solicitacao_producao_id DROP NOT NULL,
  ALTER COLUMN fornecedor_id DROP NOT NULL,
  ADD COLUMN tipo_origem text NOT NULL DEFAULT 'PRODUCAO',
  ADD COLUMN autor_id uuid REFERENCES usuario(id) ON DELETE RESTRICT,
  ADD COLUMN chave_idempotencia uuid,
  ADD COLUMN hash_entrada text,
  ADD COLUMN vendedor_fixo boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ck_fila_origem CHECK (
    (tipo_origem = 'PRODUCAO' AND solicitacao_producao_id IS NOT NULL AND fornecedor_id IS NOT NULL)
    OR (tipo_origem = 'MANUAL' AND solicitacao_producao_id IS NULL AND fornecedor_id IS NULL
      AND autor_id IS NOT NULL AND chave_idempotencia IS NOT NULL AND hash_entrada IS NOT NULL
      AND aplicativo_solicitante_id = aplicativo_fornecedor_id)
  );
CREATE UNIQUE INDEX uq_fila_manual_idempotencia
  ON pedido_fornecedor_queue(aplicativo_solicitante_id, autor_id, chave_idempotencia);
CREATE INDEX idx_fila_manual_autor ON pedido_fornecedor_queue(autor_id, created_at);
CREATE TABLE envio_pedido_manual (
  fila_id uuid PRIMARY KEY REFERENCES pedido_fornecedor_queue(id) ON DELETE RESTRICT,
  tentativa_id uuid NOT NULL,
  aplicativo_id uuid NOT NULL REFERENCES aplicativo(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  estado text NOT NULL CHECK (estado IN ('RESERVADO','CONCLUIDO','REJEITADO','INCERTO','LIBERADO')),
  iniciado_em timestamptz NOT NULL,
  chamada_em timestamptz,
  pedido_olist_id text,
  diagnostico text,
  payload jsonb NOT NULL,
  historico jsonb NOT NULL
);
CREATE UNIQUE INDEX uq_envio_manual_pedido_olist ON envio_pedido_manual(aplicativo_id, pedido_olist_id);
ALTER TABLE envio_pedido_manual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON envio_pedido_manual FROM PUBLIC, anon, authenticated;

COMMIT;
