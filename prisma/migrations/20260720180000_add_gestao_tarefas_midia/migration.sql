CREATE TYPE "PeriodicidadeTarefaMidia" AS ENUM ('DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL');
CREATE TYPE "PrioridadeTarefaMidia" AS ENUM ('ALTA', 'MEDIA', 'BAIXA');
CREATE TYPE "StatusOcorrenciaTarefaMidia" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'IGNORADA');

ALTER TABLE "usuario"
  ADD COLUMN "pode_visualizar_tarefas_midia" BOOLEAN NOT NULL DEFAULT false;

UPDATE "usuario"
SET "pode_visualizar_tarefas_midia" = true
WHERE "pode_visualizar_categorias_midia" = true;

CREATE TABLE "tarefas_midia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_id" UUID NOT NULL,
  "responsavel_id" UUID,
  "nome" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "link_apoio" TEXT,
  "periodicidade" "PeriodicidadeTarefaMidia" NOT NULL,
  "prioridade" "PrioridadeTarefaMidia" NOT NULL,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "data_inicio" DATE NOT NULL,
  "data_encerramento" DATE,
  "hora_prevista" VARCHAR(5),
  "dias_semana" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "dia_mes" INTEGER,
  "ordinal_semana_mes" INTEGER,
  "dia_semana_mensal" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarefas_midia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tarefas_midia_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE,
  CONSTRAINT "tarefas_midia_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE SET NULL
);

CREATE TABLE "ocorrencias_tarefas_midia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aplicativo_id" UUID NOT NULL,
  "tarefa_id" UUID NOT NULL,
  "data_prevista" TIMESTAMPTZ(6) NOT NULL,
  "status" "StatusOcorrenciaTarefaMidia" NOT NULL DEFAULT 'PENDENTE',
  "data_conclusao" TIMESTAMPTZ(6),
  "usuario_conclusao_id" UUID,
  "observacao" TEXT,
  "link_relacionado" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ocorrencias_tarefas_midia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ocorrencias_tarefas_midia_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE CASCADE,
  CONSTRAINT "ocorrencias_tarefas_midia_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "tarefas_midia"("id") ON DELETE CASCADE,
  CONSTRAINT "ocorrencias_tarefas_midia_usuario_conclusao_id_fkey" FOREIGN KEY ("usuario_conclusao_id") REFERENCES "usuario"("id") ON DELETE SET NULL
);

CREATE INDEX "idx_tarefa_midia_aplicativo_ativa" ON "tarefas_midia"("aplicativo_id", "ativa");
CREATE INDEX "idx_tarefa_midia_responsavel" ON "tarefas_midia"("responsavel_id");
CREATE UNIQUE INDEX "uq_ocorrencia_tarefa_midia_data" ON "ocorrencias_tarefas_midia"("tarefa_id", "data_prevista");
CREATE INDEX "idx_ocorrencia_tarefa_midia_periodo" ON "ocorrencias_tarefas_midia"("aplicativo_id", "data_prevista");
CREATE INDEX "idx_ocorrencia_tarefa_midia_status" ON "ocorrencias_tarefas_midia"("status");
