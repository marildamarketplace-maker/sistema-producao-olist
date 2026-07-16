CREATE TYPE "tipo_servico_produto_fornecedor" AS ENUM ('CORTE_LASER');

ALTER TABLE "produtos_fornecedor"
  ADD COLUMN "tipo_servico" "tipo_servico_produto_fornecedor";
