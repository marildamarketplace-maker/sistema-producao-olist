ALTER TABLE "pedido_fornecedor_queue"
  ADD COLUMN "aplicativo_filial_id" UUID,
  ADD COLUMN "direcionado_por_id" UUID,
  ADD COLUMN "direcionado_em" TIMESTAMPTZ(6),
  ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "pedido_fornecedor_queue_aplicativo_filial_id_fkey"
    FOREIGN KEY ("aplicativo_filial_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "pedido_fornecedor_queue_direcionado_por_id_fkey"
    FOREIGN KEY ("direcionado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "pedido_fornecedor_queue_direcionamento_completo" CHECK (
    ("aplicativo_filial_id" IS NULL AND "direcionado_por_id" IS NULL AND "direcionado_em" IS NULL)
    OR ("aplicativo_filial_id" IS NOT NULL AND "direcionado_por_id" IS NOT NULL AND "direcionado_em" IS NOT NULL)
  ),
  ADD CONSTRAINT "pedido_fornecedor_queue_versao_valida" CHECK ("versao" >= 0);

CREATE INDEX "idx_pedido_fornecedor_queue_filial" ON "pedido_fornecedor_queue"("aplicativo_filial_id");
CREATE INDEX "idx_pedido_fornecedor_queue_direcionado_por" ON "pedido_fornecedor_queue"("direcionado_por_id");
-- Mantém as restrições de acesso da fila original: somente API autenticada no servidor.
