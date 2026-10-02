DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE', 'ERRO', 'SUCESSO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "NotificationType" NOT NULL,
    "to" VARCHAR(30) NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "data" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "processando_em" TIMESTAMPTZ(6),
    "worker_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_tentativas_check" CHECK ("tentativas" >= 0)
);

CREATE INDEX IF NOT EXISTS "idx_notification_status_data"
ON "notification"("status", "data");

CREATE INDEX IF NOT EXISTS "idx_notification_processando_em"
ON "notification"("processando_em");

ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "notification" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "notification" FROM authenticated;
  END IF;
END $$;
