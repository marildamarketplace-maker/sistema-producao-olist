ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_tipos_produto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_editar_tipos_produto" BOOLEAN NOT NULL DEFAULT false;
