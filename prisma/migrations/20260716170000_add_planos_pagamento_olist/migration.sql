CREATE TABLE "plano_pagamento" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plano_pagamento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plano_pagamento_nome_key" UNIQUE ("nome")
);

CREATE TABLE "forma_pagamento_olist_plano" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_id" UUID NOT NULL,
  "forma_olist_id" TEXT NOT NULL,
  "forma_olist_nome" TEXT,
  "plano_pagamento_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forma_pagamento_olist_plano_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_forma_pagamento_olist_plano" UNIQUE ("aplicativo_id", "forma_olist_id", "plano_pagamento_id"),
  CONSTRAINT "forma_pagamento_olist_plano_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE,
  CONSTRAINT "forma_pagamento_olist_plano_plano_pagamento_id_fkey" FOREIGN KEY ("plano_pagamento_id") REFERENCES "plano_pagamento"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_forma_pagamento_olist_plano_forma" ON "forma_pagamento_olist_plano"("aplicativo_id", "forma_olist_id");

CREATE TABLE "forma_recebimento_olist_plano" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_id" UUID NOT NULL,
  "forma_olist_id" TEXT NOT NULL,
  "forma_olist_nome" TEXT,
  "plano_pagamento_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forma_recebimento_olist_plano_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_forma_recebimento_olist_plano" UNIQUE ("aplicativo_id", "forma_olist_id", "plano_pagamento_id"),
  CONSTRAINT "forma_recebimento_olist_plano_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE,
  CONSTRAINT "forma_recebimento_olist_plano_plano_pagamento_id_fkey" FOREIGN KEY ("plano_pagamento_id") REFERENCES "plano_pagamento"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_forma_recebimento_olist_plano_forma" ON "forma_recebimento_olist_plano"("aplicativo_id", "forma_olist_id");

INSERT INTO "plano_pagamento" ("nome") VALUES
  ('A vista'),
  ('15/30/45/60'),
  ('30'),
  ('30/45'),
  ('30/45/60'),
  ('30/60'),
  ('30/60/90/120'),
  ('30/60/90/150'),
  ('45'),
  ('60'),
  ('60/90/120');
