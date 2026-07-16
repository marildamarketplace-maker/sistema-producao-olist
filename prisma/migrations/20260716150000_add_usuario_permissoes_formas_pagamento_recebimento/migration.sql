ALTER TABLE "usuario"
ADD COLUMN "pode_visualizar_olist_formas_pagamento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pode_visualizar_olist_formas_recebimento" BOOLEAN NOT NULL DEFAULT false;
