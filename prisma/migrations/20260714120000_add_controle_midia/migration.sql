CREATE TABLE "categorias_olist" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aplicativo_id" UUID NOT NULL,
  "olist_id" TEXT NOT NULL, "nome" TEXT NOT NULL, "caminho" TEXT NOT NULL,
  "parent_olist_id" TEXT, "nivel" INTEGER NOT NULL DEFAULT 0, "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categorias_olist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categorias_olist_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "uq_categoria_olist_aplicativo_olist" ON "categorias_olist"("aplicativo_id", "olist_id");
CREATE INDEX "idx_categoria_olist_aplicativo_caminho" ON "categorias_olist"("aplicativo_id", "caminho");

CREATE TABLE "midias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aplicativo_id" UUID NOT NULL, "categoria_id" UUID,
  "tipo" TEXT NOT NULL, "titulo" TEXT, "arquivo_url" TEXT NOT NULL, "storage_path" TEXT NOT NULL,
  "content_type" TEXT NOT NULL, "largura" INTEGER, "altura" INTEGER, "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "midias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "midias_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE,
  CONSTRAINT "midias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_olist"("id") ON DELETE SET NULL
);
CREATE INDEX "idx_midia_aplicativo_tipo" ON "midias"("aplicativo_id", "tipo");
CREATE INDEX "idx_midia_categoria" ON "midias"("categoria_id");
