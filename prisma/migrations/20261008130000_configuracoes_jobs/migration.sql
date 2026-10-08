CREATE TABLE "configuracoes_jobs" (
  "chave" TEXT NOT NULL,
  "pausado" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracoes_jobs_pkey" PRIMARY KEY ("chave")
);

INSERT INTO "configuracoes_jobs" ("chave", "pausado")
VALUES ('processar-estampas', true);

ALTER TABLE "configuracoes_jobs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "configuracoes_jobs" FROM anon, authenticated;
