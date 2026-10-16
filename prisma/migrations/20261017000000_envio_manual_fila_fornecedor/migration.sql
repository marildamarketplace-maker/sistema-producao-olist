-- AlterTable
ALTER TABLE "pedido_fornecedor_solicitacao" ADD COLUMN IF NOT EXISTS "aplicativo_destinatario_id" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "envio_fornecedor" (
    "solicitacao_id" UUID NOT NULL,
    "tentativa_id" UUID NOT NULL,
    "aplicativo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "fila_id" UUID,
    "estado" TEXT NOT NULL,
    "iniciado_em" TIMESTAMPTZ(6) NOT NULL,
    "chamada_em" TIMESTAMPTZ(6),
    "pedido_olist_id" TEXT,
    "diagnostico" TEXT,
    "payload" JSONB NOT NULL,
    "historico" JSONB NOT NULL,

    CONSTRAINT "envio_fornecedor_pkey" PRIMARY KEY ("solicitacao_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "config_fornecedor_filial" (
    "fornecedor_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "selecoes" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "config_fornecedor_filial_pkey" PRIMARY KEY ("fornecedor_id","filial_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "previa_fornecedor" (
    "id" UUID NOT NULL,
    "fila_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "selecoes" JSONB NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "previa_fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "previa_fornecedor_expira_em_idx" ON "previa_fornecedor"("expira_em");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedido_fornecedor_solicitacao_aplicativo_destinatario_id_fkey' AND conrelid = 'pedido_fornecedor_solicitacao'::regclass) THEN
    ALTER TABLE "pedido_fornecedor_solicitacao" ADD CONSTRAINT "pedido_fornecedor_solicitacao_aplicativo_destinatario_id_fkey" FOREIGN KEY ("aplicativo_destinatario_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envio_fornecedor_solicitacao_id_fkey' AND conrelid = 'envio_fornecedor'::regclass) THEN
    ALTER TABLE "envio_fornecedor" ADD CONSTRAINT "envio_fornecedor_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_producao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envio_fornecedor_aplicativo_id_fkey' AND conrelid = 'envio_fornecedor'::regclass) THEN
    ALTER TABLE "envio_fornecedor" ADD CONSTRAINT "envio_fornecedor_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envio_fornecedor_usuario_id_fkey' AND conrelid = 'envio_fornecedor'::regclass) THEN
    ALTER TABLE "envio_fornecedor" ADD CONSTRAINT "envio_fornecedor_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envio_fornecedor_fila_id_fkey' AND conrelid = 'envio_fornecedor'::regclass) THEN
    ALTER TABLE "envio_fornecedor" ADD CONSTRAINT "envio_fornecedor_fila_id_fkey" FOREIGN KEY ("fila_id") REFERENCES "pedido_fornecedor_queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_fornecedor_filial_fornecedor_id_fkey' AND conrelid = 'config_fornecedor_filial'::regclass) THEN
    ALTER TABLE "config_fornecedor_filial" ADD CONSTRAINT "config_fornecedor_filial_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_fornecedor_filial_filial_id_fkey' AND conrelid = 'config_fornecedor_filial'::regclass) THEN
    ALTER TABLE "config_fornecedor_filial" ADD CONSTRAINT "config_fornecedor_filial_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'previa_fornecedor_fila_id_fkey' AND conrelid = 'previa_fornecedor'::regclass) THEN
    ALTER TABLE "previa_fornecedor" ADD CONSTRAINT "previa_fornecedor_fila_id_fkey" FOREIGN KEY ("fila_id") REFERENCES "pedido_fornecedor_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'previa_fornecedor_filial_id_fkey' AND conrelid = 'previa_fornecedor'::regclass) THEN
    ALTER TABLE "previa_fornecedor" ADD CONSTRAINT "previa_fornecedor_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'previa_fornecedor_usuario_id_fkey' AND conrelid = 'previa_fornecedor'::regclass) THEN
    ALTER TABLE "previa_fornecedor" ADD CONSTRAINT "previa_fornecedor_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Dados acessados exclusivamente pelo servidor; sem acesso direto via PostgREST.
ALTER TABLE envio_fornecedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_fornecedor_filial ENABLE ROW LEVEL SECURITY;
ALTER TABLE previa_fornecedor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON envio_fornecedor, config_fornecedor_filial, previa_fornecedor FROM anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envio_fornecedor_estado' AND conrelid = 'envio_fornecedor'::regclass) THEN
    ALTER TABLE envio_fornecedor ADD CONSTRAINT envio_fornecedor_estado CHECK (estado IN ('RESERVADO','INCERTO','REJEITADO','CONCLUIDO','LIBERADO'));
  END IF;
END $$;
