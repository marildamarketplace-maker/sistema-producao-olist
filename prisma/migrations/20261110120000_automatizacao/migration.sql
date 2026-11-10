BEGIN;

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "pode_editar_habilidades" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_gerenciar_rotinas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_intervir_automatizacao" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_visualizar_automatizacao" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "automatizacao_habilidade" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativoId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "automatizacao_habilidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacao_habilidade_versao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativoId" UUID NOT NULL,
    "habilidadeId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automatizacao_habilidade_versao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacao_rotina" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativoId" UUID NOT NULL,
    "habilidadeId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "horarios" JSONB NOT NULL,
    "cursor" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automatizacao_rotina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacao_disparo" (
    "aplicativoId" UUID NOT NULL,
    "rotinaId" UUID NOT NULL,
    "previstoEm" TIMESTAMPTZ(6) NOT NULL,
    "motivo" TEXT NOT NULL,

    CONSTRAINT "automatizacao_disparo_pkey" PRIMARY KEY ("aplicativoId","rotinaId","previstoEm")
);

-- CreateTable
CREATE TABLE "automatizacao_execucao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativoId" UUID NOT NULL,
    "rotinaId" UUID NOT NULL,
    "versaoId" UUID NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'EXECUTAR_PROMPT',
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "previstoEm" TIMESTAMPTZ(6) NOT NULL,
    "disponivelEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reserva" UUID,
    "reservaAte" TIMESTAMPTZ(6),
    "worker" TEXT,
    "tentativa" INTEGER NOT NULL DEFAULT 0,
    "rodada" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "automatizacao_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacao_tentativa" (
    "id" UUID NOT NULL,
    "execucaoId" UUID NOT NULL,
    "worker" TEXT NOT NULL,
    "rodada" INTEGER NOT NULL,
    "iniciadaEm" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'EM_EXECUCAO',
    "resultado" TEXT,

    CONSTRAINT "automatizacao_tentativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacao_aviso" (
    "tentativaId" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "destinatario" TEXT NOT NULL,

    CONSTRAINT "automatizacao_aviso_pkey" PRIMARY KEY ("tentativaId","destinatario")
);

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_habilidade_aplicativoId_id_key" ON "automatizacao_habilidade"("aplicativoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_habilidade_versao_aplicativoId_id_key" ON "automatizacao_habilidade_versao"("aplicativoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_habilidade_versao_habilidadeId_numero_key" ON "automatizacao_habilidade_versao"("habilidadeId", "numero");

-- CreateIndex
CREATE INDEX "automatizacao_rotina_ativa_cursor_idx" ON "automatizacao_rotina"("ativa", "cursor");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_rotina_aplicativoId_id_key" ON "automatizacao_rotina"("aplicativoId", "id");

-- CreateIndex
CREATE INDEX "automatizacao_execucao_aplicativoId_previstoEm_idx" ON "automatizacao_execucao"("aplicativoId", "previstoEm");

-- CreateIndex
CREATE INDEX "automatizacao_execucao_aplicativoId_tipo_status_disponivelE_idx" ON "automatizacao_execucao"("aplicativoId", "tipo", "status", "disponivelEm");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_execucao_aplicativoId_rotinaId_previstoEm_key" ON "automatizacao_execucao"("aplicativoId", "rotinaId", "previstoEm");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_rotina_bloqueada" ON "automatizacao_execucao"("aplicativoId", "rotinaId") WHERE (status <> 'CONCLUIDA'::text);

-- CreateIndex
CREATE INDEX "automatizacao_tentativa_execucaoId_iniciadaEm_idx" ON "automatizacao_tentativa"("execucaoId", "iniciadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "automatizacao_aviso_notificationId_key" ON "automatizacao_aviso"("notificationId");

-- AddForeignKey
ALTER TABLE "automatizacao_habilidade_versao" ADD CONSTRAINT "automatizacao_habilidade_versao_aplicativoId_habilidadeId_fkey" FOREIGN KEY ("aplicativoId", "habilidadeId") REFERENCES "automatizacao_habilidade"("aplicativoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_rotina" ADD CONSTRAINT "automatizacao_rotina_aplicativoId_habilidadeId_fkey" FOREIGN KEY ("aplicativoId", "habilidadeId") REFERENCES "automatizacao_habilidade"("aplicativoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_disparo" ADD CONSTRAINT "automatizacao_disparo_aplicativoId_rotinaId_fkey" FOREIGN KEY ("aplicativoId", "rotinaId") REFERENCES "automatizacao_rotina"("aplicativoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_execucao" ADD CONSTRAINT "automatizacao_execucao_aplicativoId_rotinaId_fkey" FOREIGN KEY ("aplicativoId", "rotinaId") REFERENCES "automatizacao_rotina"("aplicativoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_execucao" ADD CONSTRAINT "automatizacao_execucao_aplicativoId_versaoId_fkey" FOREIGN KEY ("aplicativoId", "versaoId") REFERENCES "automatizacao_habilidade_versao"("aplicativoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_tentativa" ADD CONSTRAINT "automatizacao_tentativa_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "automatizacao_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_aviso" ADD CONSTRAINT "automatizacao_aviso_tentativaId_fkey" FOREIGN KEY ("tentativaId") REFERENCES "automatizacao_tentativa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacao_aviso" ADD CONSTRAINT "automatizacao_aviso_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE public.automatizacao_habilidade
  ADD CONSTRAINT "automatizacao_habilidade_aplicativoId_fkey" FOREIGN KEY ("aplicativoId")
  REFERENCES public.aplicativo(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.automatizacao_habilidade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_habilidade FROM anon, authenticated;

ALTER TABLE public.automatizacao_habilidade_versao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_habilidade_versao FROM anon, authenticated;

ALTER TABLE public.automatizacao_rotina ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_rotina FROM anon, authenticated;

ALTER TABLE public.automatizacao_disparo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_disparo FROM anon, authenticated;

ALTER TABLE public.automatizacao_execucao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_execucao FROM anon, authenticated;

ALTER TABLE public.automatizacao_tentativa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_tentativa FROM anon, authenticated;

ALTER TABLE public.automatizacao_aviso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatizacao_aviso FROM anon, authenticated;

COMMIT;
