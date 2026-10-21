BEGIN;

-- CreateTable
CREATE TABLE "retornos_estoque_olist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "chave_idempotencia" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retornos_estoque_olist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_retorno_estoque_olist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "retorno_id" UUID NOT NULL,
    "aplicativo_id" UUID NOT NULL,
    "item_baixa_id" UUID NOT NULL,
    "movimentacao_id" UUID NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "itens_retorno_estoque_olist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_retorno_olist_aplicativo_data" ON "retornos_estoque_olist"("aplicativo_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retorno_olist_idempotencia" ON "retornos_estoque_olist"("aplicativo_id", "chave_idempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "itens_retorno_estoque_olist_movimentacao_id_key" ON "itens_retorno_estoque_olist"("movimentacao_id");

-- CreateIndex
CREATE INDEX "idx_retorno_olist_baixa" ON "itens_retorno_estoque_olist"("aplicativo_id", "item_baixa_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retorno_olist_item" ON "itens_retorno_estoque_olist"("retorno_id", "item_baixa_id");

-- AddForeignKey
ALTER TABLE "retornos_estoque_olist" ADD CONSTRAINT "retornos_estoque_olist_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos_estoque_olist" ADD CONSTRAINT "retornos_estoque_olist_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_retorno_estoque_olist" ADD CONSTRAINT "itens_retorno_estoque_olist_retorno_id_fkey" FOREIGN KEY ("retorno_id") REFERENCES "retornos_estoque_olist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_retorno_estoque_olist" ADD CONSTRAINT "itens_retorno_estoque_olist_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_retorno_estoque_olist" ADD CONSTRAINT "itens_retorno_estoque_olist_item_baixa_id_fkey" FOREIGN KEY ("item_baixa_id") REFERENCES "itens_baixa_estoque_olist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_retorno_estoque_olist" ADD CONSTRAINT "itens_retorno_estoque_olist_movimentacao_id_fkey" FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Apenas as APIs autenticadas do servidor acessam os registros de retorno.
ALTER TABLE public.retornos_estoque_olist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_retorno_estoque_olist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retornos_estoque_olist FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.itens_retorno_estoque_olist FROM PUBLIC, anon, authenticated;
ALTER TABLE public.itens_retorno_estoque_olist
  ADD CONSTRAINT retorno_olist_quantidade_positiva CHECK (quantidade > 0);

COMMIT;
