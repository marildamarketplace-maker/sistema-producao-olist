-- CreateTable
CREATE TABLE "olist_sync_recibo_pagina" (
    "etapa_id" UUID NOT NULL,
    "digest" CHAR(64) NOT NULL,

    CONSTRAINT "olist_sync_recibo_pagina_pkey" PRIMARY KEY ("etapa_id","digest")
);

-- AddForeignKey
ALTER TABLE "olist_sync_recibo_pagina" ADD CONSTRAINT "olist_sync_recibo_pagina_etapa_id_fkey" FOREIGN KEY ("etapa_id") REFERENCES "olist_sync_etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recibos internos, temporários e opacos; nunca acessíveis pela Data API pública.
ALTER TABLE "olist_sync_recibo_pagina" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "olist_sync_recibo_pagina" FROM PUBLIC, anon, authenticated;
