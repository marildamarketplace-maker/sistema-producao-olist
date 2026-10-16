CREATE TABLE "pedido_fornecedor_queue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_solicitante_id" UUID NOT NULL REFERENCES "aplicativo"("id") ON UPDATE NO ACTION,
  "solicitacao_producao_id" UUID NOT NULL REFERENCES "solicitacoes_producao"("id") ON UPDATE NO ACTION,
  "aplicativo_fornecedor_id" UUID NOT NULL REFERENCES "aplicativo"("id") ON UPDATE NO ACTION,
  "fornecedor_id" UUID NOT NULL REFERENCES "fornecedores"("id") ON UPDATE NO ACTION,
  "dados_pedido" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pedido_fornecedor_queue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_pedido_fornecedor_queue_solicitacao" UNIQUE ("solicitacao_producao_id")
);
CREATE INDEX "idx_pedido_fornecedor_queue_origem" ON "pedido_fornecedor_queue"("aplicativo_solicitante_id");
CREATE INDEX "idx_pedido_fornecedor_queue_destino" ON "pedido_fornecedor_queue"("aplicativo_fornecedor_id", "created_at");
CREATE INDEX "idx_pedido_fornecedor_queue_fornecedor" ON "pedido_fornecedor_queue"("fornecedor_id");
-- Acesso exclusivamente pelo servidor; autorização e isolamento validados na API.
ALTER TABLE "pedido_fornecedor_queue" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "pedido_fornecedor_queue" FROM anon, authenticated;
