ALTER TABLE "usuario"
ADD COLUMN "pode_escrever_anotar_sku" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_visualizar_anotar_sku" BOOLEAN NOT NULL DEFAULT false;
