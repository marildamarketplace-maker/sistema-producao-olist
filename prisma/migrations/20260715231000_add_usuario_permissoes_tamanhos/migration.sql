ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_tamanhos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_editar_tamanhos" BOOLEAN NOT NULL DEFAULT false;
