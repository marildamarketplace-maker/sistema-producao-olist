CREATE TABLE "componentes_kit_estoque" (
  "aplicativo_id" UUID NOT NULL REFERENCES "aplicativo"("id"),
  "kit_sku" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL CHECK (quantidade > 0),
  PRIMARY KEY ("aplicativo_id", "kit_sku", "sku"),
  CHECK (kit_sku <> sku)
);
-- A composição só pode ser acessada pelo servidor autenticado.
ALTER TABLE "componentes_kit_estoque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itens_baixa_estoque_olist" ADD COLUMN "sku_origem" TEXT;
ALTER TABLE "itens_baixa_estoque_olist" DROP CONSTRAINT IF EXISTS "uq_itens_baixa_olist_pedido_item";
DROP INDEX IF EXISTS "uq_itens_baixa_olist_pedido_item";
CREATE UNIQUE INDEX "uq_itens_baixa_olist_pedido_item_sku" ON "itens_baixa_estoque_olist"("pedido_olist_id", "item_olist_id", "sku");

REVOKE ALL ON "componentes_kit_estoque" FROM PUBLIC, anon, authenticated;
