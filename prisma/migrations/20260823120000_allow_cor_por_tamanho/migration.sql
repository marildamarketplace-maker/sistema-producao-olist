DROP INDEX IF EXISTS "uq_variante_estampa_codigo";

CREATE UNIQUE INDEX "uq_variante_estampa_tamanho_codigo"
ON "variante" ("estampa_id", "tamanho_id", "codigo");
