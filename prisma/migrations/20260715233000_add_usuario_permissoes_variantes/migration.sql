ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_variantes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_editar_variantes" BOOLEAN NOT NULL DEFAULT false;
