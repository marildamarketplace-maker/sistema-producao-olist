ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_estampas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_editar_estampas" BOOLEAN NOT NULL DEFAULT false;
