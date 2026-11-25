BEGIN;
CREATE TABLE direcionamento_pedidos (
  aplicativo_pai_id uuid PRIMARY KEY REFERENCES aplicativo(id) ON DELETE RESTRICT,
  aplicativo_padrao_id uuid NOT NULL REFERENCES aplicativo(id) ON DELETE RESTRICT,
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  regras jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(regras) = 'array' AND jsonb_array_length(regras) <= 50),
  atualizado_por_id uuid NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direcionamento_pedidos_aplicativo_padrao_id_idx ON direcionamento_pedidos(aplicativo_padrao_id);
ALTER TABLE direcionamento_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON direcionamento_pedidos FROM PUBLIC, anon, authenticated;
COMMIT;
