-- Estrutura mínima isolada para os testes de retorno; sem dados ou conexão de produção.

CREATE TABLE "aplicativo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "aplicativo_pai_id" UUID,
    "jobs" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "olist_client_id" TEXT,
    "olist_client_secret" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aplicativo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativo_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "pode_visualizar_estoque" BOOLEAN NOT NULL DEFAULT false,
    "pode_editar_estoque" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_baixa" BOOLEAN NOT NULL DEFAULT false,
    "pode_solicitar_baixa" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_devolucao" BOOLEAN NOT NULL DEFAULT false,
    "pode_solicitar_devolucao" BOOLEAN NOT NULL DEFAULT false,
    "pode_solicitar_producao" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_producao" BOOLEAN NOT NULL DEFAULT false,
    "pode_confirmar_producao" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_configuracao" BOOLEAN NOT NULL DEFAULT false,
    "pode_selecionar_filial_fornecedor" BOOLEAN NOT NULL DEFAULT false,
    "pode_gerenciar_fila_pedidos" BOOLEAN NOT NULL DEFAULT false,
    "pode_editar_configuracao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pode_visualizar_categorias_midia" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_dashboard" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_fornecedores" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_produtos_fornecedor" BOOLEAN NOT NULL DEFAULT false,
    "pode_criar_olist_pedido" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_contatos" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_pedidos" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_produtos" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_vendedores" BOOLEAN NOT NULL DEFAULT false,
    "vendedor_olist_id" INTEGER,
    "pode_editar_estampas" BOOLEAN NOT NULL DEFAULT false,
    "pode_editar_tamanhos" BOOLEAN NOT NULL DEFAULT false,
    "pode_editar_tipos_produto" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_estampas" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_tamanhos" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_tipos_produto" BOOLEAN NOT NULL DEFAULT false,
    "pode_editar_variantes" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_variantes" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_formas_pagamento" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_olist_formas_recebimento" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_tarefas_midia" BOOLEAN NOT NULL DEFAULT false,
    "pode_escrever_anotar_sku" BOOLEAN NOT NULL DEFAULT false,
    "pode_visualizar_anotar_sku" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "produtos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "imagem_url" TEXT,
    "meta_estoque" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minimo_estoque" INTEGER,
    "aplicativo_id" UUID DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    "id_cadastro_olist" TEXT,
    "tem_foto" BOOLEAN NOT NULL DEFAULT false,
    "tem_video" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "baixas_estoque_olist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "origem" TEXT NOT NULL,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicativo_id" UUID DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

    CONSTRAINT "baixas_estoque_olist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "itens_baixa_estoque_olist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "baixa_id" UUID NOT NULL,
    "produto_id" UUID,
    "sku" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "pedido_olist_id" TEXT,
    "item_olist_id" TEXT,
    "observacao" TEXT,
    "origem" TEXT NOT NULL,
    "movimentacao_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicativo_id" UUID DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

    CONSTRAINT "itens_baixa_estoque_olist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movimentacoes_estoque" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "produto_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "tipo_movimento" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "origem" TEXT NOT NULL,
    "referencia_id" UUID,
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicativo_id" UUID DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

    CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);

-- Estado estrutural ja existente antes das correcoes de RLS/CHECK.
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
ALTER TABLE itens_retorno_estoque_olist ALTER COLUMN movimentacao_id DROP NOT NULL;
ALTER TABLE itens_baixa_estoque_olist ADD COLUMN sku_origem TEXT;
