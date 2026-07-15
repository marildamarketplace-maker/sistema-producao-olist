ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_olist_produtos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_visualizar_olist_contatos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_visualizar_olist_pedidos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_criar_olist_pedido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_visualizar_olist_vendedores" BOOLEAN NOT NULL DEFAULT false;
