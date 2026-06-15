CREATE TABLE "produto_olist_produto_fornecedor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "produto_id" UUID NOT NULL,
  "produto_olist_id" UUID,
  "produto_fornecedor_id" UUID NOT NULL,
  "quantidade_usada" DECIMAL(10, 4) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "produto_olist_produto_fornecedor_pkey" PRIMARY KEY ("id")
);

INSERT INTO "produto_olist_produto_fornecedor" (
  "produto_id",
  "produto_olist_id",
  "produto_fornecedor_id",
  "quantidade_usada",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (produto_origem."id")
  produto_origem."id",
  produto_origem."produto_olist_id",
  produto_origem."produto_fornecedor_id",
  produto_origem."quantidade_usada",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    COALESCE(po."produto_id", p."id") AS "id",
    po."id" AS "produto_olist_id",
    tppf."produto_fornecedor_id",
    tppf."quantidade_usada"
  FROM "produto_olist" po
  INNER JOIN "tipo_produto_produto_fornecedor" tppf
    ON tppf."tipo_produto_id" = po."tipo_produto_id"
  LEFT JOIN "produtos" p
    ON p."sku" = po."sku_final"
  WHERE COALESCE(po."produto_id", p."id") IS NOT NULL
) produto_origem
ORDER BY produto_origem."id", produto_origem."produto_olist_id", produto_origem."produto_fornecedor_id"
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "uq_produto_olist_produto_fornecedor_produto_id"
  ON "produto_olist_produto_fornecedor"("produto_id");

CREATE INDEX "idx_produto_olist_produto_fornecedor_produto_olist_id"
  ON "produto_olist_produto_fornecedor"("produto_olist_id");

CREATE INDEX "idx_produto_olist_produto_fornecedor_produto_id"
  ON "produto_olist_produto_fornecedor"("produto_fornecedor_id");

ALTER TABLE "produto_olist_produto_fornecedor"
  ADD CONSTRAINT "produto_olist_produto_fornecedor_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "produto_olist_produto_fornecedor"
  ADD CONSTRAINT "produto_olist_produto_fornecedor_produto_olist_id_fkey"
  FOREIGN KEY ("produto_olist_id") REFERENCES "produto_olist"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "produto_olist_produto_fornecedor"
  ADD CONSTRAINT "produto_olist_produto_fornecedor_produto_fornecedor_id_fkey"
  FOREIGN KEY ("produto_fornecedor_id") REFERENCES "produtos_fornecedor"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
