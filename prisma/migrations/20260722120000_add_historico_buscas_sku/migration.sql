CREATE TABLE "buscas_sku" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_id" UUID NOT NULL,
  "situacoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "quantidade_pedidos" INTEGER NOT NULL DEFAULT 0,
  "quantidade_skus" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buscas_sku_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "itens_busca_sku" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "busca_id" UUID NOT NULL,
  "aplicativo_id" UUID NOT NULL,
  "pedido_olist_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "itens_busca_sku_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_buscas_sku_aplicativo_created_at" ON "buscas_sku"("aplicativo_id", "created_at");
CREATE INDEX "idx_itens_busca_sku_busca_id" ON "itens_busca_sku"("busca_id");
CREATE INDEX "idx_itens_busca_sku_aplicativo_pedido" ON "itens_busca_sku"("aplicativo_id", "pedido_olist_id");
CREATE UNIQUE INDEX "uq_itens_busca_sku_aplicativo_pedido_sku" ON "itens_busca_sku"("aplicativo_id", "pedido_olist_id", "sku");

ALTER TABLE "buscas_sku"
  ADD CONSTRAINT "buscas_sku_aplicativo_id_fkey"
  FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "itens_busca_sku"
  ADD CONSTRAINT "itens_busca_sku_busca_id_fkey"
  FOREIGN KEY ("busca_id") REFERENCES "buscas_sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "itens_busca_sku"
  ADD CONSTRAINT "itens_busca_sku_aplicativo_id_fkey"
  FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
