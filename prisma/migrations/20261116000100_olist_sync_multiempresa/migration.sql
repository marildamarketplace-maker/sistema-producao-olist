-- Aplicar isoladamente, após revisão; não executar migrate deploy global.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "pode_configurar_sincronizacao_olist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_executar_sincronizacao_olist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_resolver_sincronizacao_olist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pode_visualizar_sincronizacao_olist" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "olist_sync_configuracao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aplicativo_pai_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "aplicativos_bloqueados" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "entidades" TEXT[] DEFAULT ARRAY['PRODUTO', 'CONTATO', 'FORMA_PAGAMENTO', 'VENDEDOR']::TEXT[],
    "versao" INTEGER NOT NULL DEFAULT 1,
    "politicas_json" JSONB NOT NULL DEFAULT '{}',
    "readiness_json" JSONB NOT NULL DEFAULT '{}',
    "hora_diaria" VARCHAR(5) NOT NULL DEFAULT '02:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "proxima_execucao_em" TIMESTAMPTZ(6),
    "ultima_limpeza_em" TIMESTAMPTZ(6),
    "autorizado_por" UUID,
    "limite_alteracoes" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_configuracao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "olist_sync_configuracao_bloqueios_validos" CHECK (array_position(aplicativos_bloqueados, NULL) IS NULL)
);

-- CreateTable
CREATE TABLE "olist_sync_participante" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "aplicativo_id" UUID NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT false,
    "conta_identidade" TEXT,
    "proxima_chamada_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_participante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_registro" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "entidade" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT,
    "hashes_base_json" JSONB NOT NULL DEFAULT '{}',
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "aplicativo_origem_id" UUID,
    "registro_olist_origem_id" TEXT,
    "origem_tipo" TEXT NOT NULL DEFAULT 'DESCONHECIDA',
    "origem_registrada_em" TIMESTAMPTZ(6),
    "origem_registrada_por" UUID,
    "origem_execucao_id" UUID,
    "origem_motivo" VARCHAR(1000),
    "ultima_fonte_app_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_registro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_estado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "registro_id" UUID,
    "aplicativo_id" UUID NOT NULL,
    "entidade" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "chave" TEXT,
    "nome" TEXT,
    "situacao_remota" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NAO_VERIFICADO',
    "hashes_json" JSONB NOT NULL DEFAULT '{}',
    "metadados_json" JSONB NOT NULL DEFAULT '{}',
    "dados_criptografados" TEXT,
    "ultima_execucao_id" UUID,
    "verificado_em" TIMESTAMPTZ(6),
    "revisao_aplicada" INTEGER,
    "ultima_fonte_app_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_estado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_execucao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "chave_idempotencia" UUID NOT NULL,
    "modo" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "completa" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "versao_configuracao" INTEGER NOT NULL,
    "solicitado_por" UUID,
    "iniciada_em" TIMESTAMPTZ(6),
    "finalizada_em" TIMESTAMPTZ(6),
    "cancelamento_solicitado" BOOLEAN NOT NULL DEFAULT false,
    "contadores_json" JSONB NOT NULL DEFAULT '{}',
    "erro_codigo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_etapa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execucao_id" UUID NOT NULL,
    "entidade" TEXT NOT NULL,
    "aplicativo_id" UUID,
    "fase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "cursor_json" JSONB NOT NULL DEFAULT '{}',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "disponivel_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_ate" TIMESTAMPTZ(6),
    "erro_codigo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_operacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "execucao_id" UUID,
    "source_app_id" UUID NOT NULL,
    "destino_app_id" UUID NOT NULL,
    "acao" TEXT NOT NULL,
    "revisao" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSTA',
    "precondicoes_json" JSONB NOT NULL DEFAULT '{}',
    "payload_criptografado" TEXT,
    "resultado_criptografado" TEXT,
    "remote_id" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro_codigo" TEXT,
    "confirmada_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_operacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_pendencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "registro_id" UUID,
    "aplicativo_id" UUID,
    "execucao_id" UUID,
    "entidade" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO_REVISAO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "chave_dedupe" TEXT NOT NULL,
    "detalhes_criptografados" TEXT,
    "decisao_json" JSONB NOT NULL DEFAULT '{}',
    "motivo" VARCHAR(1000),
    "decidido_por" UUID,
    "decidido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_pendencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olist_sync_evento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configuracao_id" UUID NOT NULL,
    "execucao_id" UUID,
    "registro_id" UUID,
    "tipo" TEXT NOT NULL,
    "usuario_id" UUID,
    "metadados_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "olist_sync_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_configuracao_aplicativo_pai_id_key" ON "olist_sync_configuracao"("aplicativo_pai_id");

-- CreateIndex
CREATE INDEX "olist_sync_configuracao_ativo_proxima_execucao_em_idx" ON "olist_sync_configuracao"("ativo", "proxima_execucao_em");

-- CreateIndex
CREATE INDEX "olist_sync_participante_aplicativo_id_habilitado_idx" ON "olist_sync_participante"("aplicativo_id", "habilitado");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_participante_configuracao_id_aplicativo_id_key" ON "olist_sync_participante"("configuracao_id", "aplicativo_id");

-- CreateIndex
CREATE INDEX "olist_sync_registro_configuracao_id_entidade_id_idx" ON "olist_sync_registro"("configuracao_id", "entidade", "id");

-- CreateIndex
CREATE INDEX "olist_sync_registro_configuracao_id_aplicativo_origem_id_id_idx" ON "olist_sync_registro"("configuracao_id", "aplicativo_origem_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_registro_configuracao_id_entidade_chave_key" ON "olist_sync_registro"("configuracao_id", "entidade", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_registro_id_configuracao_id_key" ON "olist_sync_registro"("id", "configuracao_id");

-- CreateIndex
CREATE INDEX "olist_sync_estado_configuracao_id_entidade_chave_idx" ON "olist_sync_estado"("configuracao_id", "entidade", "chave");

-- CreateIndex
CREATE INDEX "olist_sync_estado_configuracao_id_status_id_idx" ON "olist_sync_estado"("configuracao_id", "status", "id");

-- CreateIndex
CREATE INDEX "olist_sync_estado_ultima_execucao_id_idx" ON "olist_sync_estado"("ultima_execucao_id");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_estado_aplicativo_id_entidade_remote_id_key" ON "olist_sync_estado"("aplicativo_id", "entidade", "remote_id");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_estado_registro_id_aplicativo_id_key" ON "olist_sync_estado"("registro_id", "aplicativo_id");

-- CreateIndex
CREATE INDEX "olist_sync_execucao_configuracao_id_created_at_id_idx" ON "olist_sync_execucao"("configuracao_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "olist_sync_execucao_status_finalizada_em_idx" ON "olist_sync_execucao"("status", "finalizada_em");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_execucao_ativa_unica" ON "olist_sync_execucao"("configuracao_id") WHERE (status IN ('PENDENTE', 'AUDITANDO', 'APLICANDO', 'AGUARDANDO_RETRY'));

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_execucao_configuracao_id_chave_idempotencia_key" ON "olist_sync_execucao"("configuracao_id", "chave_idempotencia");

-- CreateIndex
CREATE INDEX "olist_sync_etapa_status_disponivel_em_id_idx" ON "olist_sync_etapa"("status", "disponivel_em", "id");

-- CreateIndex
CREATE INDEX "olist_sync_etapa_status_lease_ate_idx" ON "olist_sync_etapa"("status", "lease_ate");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_etapa_grupo_unica" ON "olist_sync_etapa"("execucao_id", "entidade", "fase") WHERE (aplicativo_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_etapa_execucao_id_entidade_aplicativo_id_fase_key" ON "olist_sync_etapa"("execucao_id", "entidade", "aplicativo_id", "fase");

-- CreateIndex
CREATE INDEX "olist_sync_operacao_configuracao_id_status_id_idx" ON "olist_sync_operacao"("configuracao_id", "status", "id");

-- CreateIndex
CREATE INDEX "olist_sync_operacao_execucao_id_status_idx" ON "olist_sync_operacao"("execucao_id", "status");

-- CreateIndex
CREATE INDEX "olist_sync_operacao_status_updated_at_idx" ON "olist_sync_operacao"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_operacao_registro_id_destino_app_id_revisao_acao_key" ON "olist_sync_operacao"("registro_id", "destino_app_id", "revisao", "acao");

-- CreateIndex
CREATE INDEX "olist_sync_pendencia_configuracao_id_status_severidade_id_idx" ON "olist_sync_pendencia"("configuracao_id", "status", "severidade", "id");

-- Associação consultável sem decifrar detalhes; preserva filtro e paginação no banco.
CREATE INDEX "olist_sync_pendencia_empresa_criacao_idx" ON "olist_sync_pendencia"("configuracao_id", "aplicativo_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "olist_sync_pendencia_execucao_id_idx" ON "olist_sync_pendencia"("execucao_id");

-- CreateIndex
CREATE INDEX "olist_sync_pendencia_status_decidido_em_idx" ON "olist_sync_pendencia"("status", "decidido_em");

-- CreateIndex
CREATE UNIQUE INDEX "olist_sync_pendencia_configuracao_id_chave_dedupe_key" ON "olist_sync_pendencia"("configuracao_id", "chave_dedupe");

-- CreateIndex
CREATE INDEX "olist_sync_evento_configuracao_id_created_at_id_idx" ON "olist_sync_evento"("configuracao_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "olist_sync_evento_execucao_id_idx" ON "olist_sync_evento"("execucao_id");

-- CreateIndex
CREATE INDEX "olist_sync_evento_tipo_created_at_idx" ON "olist_sync_evento"("tipo", "created_at");

-- AddForeignKey
ALTER TABLE "olist_sync_configuracao" ADD CONSTRAINT "olist_sync_configuracao_aplicativo_pai_id_fkey" FOREIGN KEY ("aplicativo_pai_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_participante" ADD CONSTRAINT "olist_sync_participante_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_participante" ADD CONSTRAINT "olist_sync_participante_aplicativo_id_fkey" FOREIGN KEY ("aplicativo_id") REFERENCES "aplicativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_registro" ADD CONSTRAINT "olist_sync_registro_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_estado" ADD CONSTRAINT "olist_sync_estado_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_estado" ADD CONSTRAINT "olist_sync_estado_configuracao_id_aplicativo_id_fkey" FOREIGN KEY ("configuracao_id", "aplicativo_id") REFERENCES "olist_sync_participante"("configuracao_id", "aplicativo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_estado" ADD CONSTRAINT "olist_sync_estado_registro_id_configuracao_id_fkey" FOREIGN KEY ("registro_id", "configuracao_id") REFERENCES "olist_sync_registro"("id", "configuracao_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_execucao" ADD CONSTRAINT "olist_sync_execucao_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_etapa" ADD CONSTRAINT "olist_sync_etapa_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "olist_sync_execucao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_operacao" ADD CONSTRAINT "olist_sync_operacao_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_operacao" ADD CONSTRAINT "olist_sync_operacao_registro_id_configuracao_id_fkey" FOREIGN KEY ("registro_id", "configuracao_id") REFERENCES "olist_sync_registro"("id", "configuracao_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_operacao" ADD CONSTRAINT "olist_sync_operacao_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "olist_sync_execucao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_pendencia" ADD CONSTRAINT "olist_sync_pendencia_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "olist_sync_pendencia" ADD CONSTRAINT "olist_sync_pendencia_configuracao_id_aplicativo_id_fkey" FOREIGN KEY ("configuracao_id", "aplicativo_id") REFERENCES "olist_sync_participante"("configuracao_id", "aplicativo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_pendencia" ADD CONSTRAINT "olist_sync_pendencia_registro_id_configuracao_id_fkey" FOREIGN KEY ("registro_id", "configuracao_id") REFERENCES "olist_sync_registro"("id", "configuracao_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_pendencia" ADD CONSTRAINT "olist_sync_pendencia_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "olist_sync_execucao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_evento" ADD CONSTRAINT "olist_sync_evento_configuracao_id_fkey" FOREIGN KEY ("configuracao_id") REFERENCES "olist_sync_configuracao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_evento" ADD CONSTRAINT "olist_sync_evento_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "olist_sync_execucao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olist_sync_evento" ADD CONSTRAINT "olist_sync_evento_registro_id_configuracao_id_fkey" FOREIGN KEY ("registro_id", "configuracao_id") REFERENCES "olist_sync_registro"("id", "configuracao_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Busca de possíveis duplicidades não modifica a chave de correspondência SKU.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX olist_sync_registro_nome_trgm ON olist_sync_registro USING gin(nome gin_trgm_ops) WHERE entidade='PRODUTO';
CREATE INDEX olist_sync_registro_chave_normalizada ON olist_sync_registro(configuracao_id, lower(btrim(chave))) WHERE entidade='PRODUTO';

-- Proteções que não são expressas pelo datamodel Prisma.
ALTER TABLE olist_sync_configuracao
  ADD CONSTRAINT olist_sync_config_limite CHECK (limite_alteracoes BETWEEN 1 AND 100),
  ADD CONSTRAINT olist_sync_config_versao CHECK (versao > 0),
  ADD CONSTRAINT olist_sync_config_hora CHECK (hora_diaria ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT olist_sync_config_entidades CHECK (cardinality(entidades) BETWEEN 1 AND 4 AND entidades <@ ARRAY['PRODUTO','CONTATO','FORMA_PAGAMENTO','VENDEDOR']);
ALTER TABLE olist_sync_registro
  ADD CONSTRAINT olist_sync_registro_origem CHECK (origem_tipo IN ('DESCONHECIDA','OBSERVADA_PELO_MODULO','DECLARADA_POR_USUARIO')),
  ADD CONSTRAINT olist_sync_registro_origem_coerente CHECK ((origem_tipo='DESCONHECIDA' AND aplicativo_origem_id IS NULL AND registro_olist_origem_id IS NULL) OR (origem_tipo<>'DESCONHECIDA' AND aplicativo_origem_id IS NOT NULL AND origem_registrada_em IS NOT NULL)),
  ADD CONSTRAINT olist_sync_registro_revisao CHECK (revisao > 0),
  ADD CONSTRAINT olist_sync_origem_app_fkey FOREIGN KEY (aplicativo_origem_id) REFERENCES aplicativo(id) ON DELETE RESTRICT,
  ADD CONSTRAINT olist_sync_origem_execucao_fkey FOREIGN KEY (origem_execucao_id) REFERENCES olist_sync_execucao(id) ON DELETE SET NULL;
ALTER TABLE olist_sync_estado
  ADD CONSTRAINT olist_sync_estado_execucao_fkey FOREIGN KEY (ultima_execucao_id) REFERENCES olist_sync_execucao(id) ON DELETE SET NULL;
ALTER TABLE olist_sync_execucao
  ADD CONSTRAINT olist_sync_execucao_modo CHECK (modo IN ('AUDITAR','AUDITAR_E_APLICAR','APLICAR')),
  ADD CONSTRAINT olist_sync_execucao_origem CHECK (origem IN ('MANUAL','AGENDADA')),
  ADD CONSTRAINT olist_sync_execucao_status CHECK (status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY','CONCLUIDA','CONCLUIDA_COM_PENDENCIAS','FALHOU','CANCELADA'));
ALTER TABLE olist_sync_etapa
  ADD CONSTRAINT olist_sync_etapa_fase CHECK (fase IN ('LISTAR','DETALHAR','COMPARAR','APLICAR')),
  ADD CONSTRAINT olist_sync_etapa_status CHECK (status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY','CONCLUIDA','FALHOU','CANCELADA','PAUSADA')),
  ADD CONSTRAINT olist_sync_etapa_tentativas CHECK (tentativas BETWEEN 0 AND 5),
  ADD CONSTRAINT olist_sync_etapa_lease CHECK ((lease_token IS NULL) = (lease_ate IS NULL));
ALTER TABLE olist_sync_operacao
  ADD CONSTRAINT olist_sync_operacao_acao CHECK (acao IN ('CRIAR','ATUALIZAR')),
  ADD CONSTRAINT olist_sync_operacao_destino CHECK (source_app_id <> destino_app_id),
  ADD CONSTRAINT olist_sync_operacao_status CHECK (status IN ('PROPOSTA','AUTORIZADA','EM_APLICACAO','VERIFICANDO','CONFIRMADA','RESULTADO_INCONCLUSIVO','OBSOLETA','FALHA_PERMANENTE')),
  ADD CONSTRAINT olist_sync_operacao_origem_membro FOREIGN KEY (configuracao_id, source_app_id) REFERENCES olist_sync_participante(configuracao_id, aplicativo_id) ON DELETE RESTRICT,
  ADD CONSTRAINT olist_sync_operacao_destino_membro FOREIGN KEY (configuracao_id, destino_app_id) REFERENCES olist_sync_participante(configuracao_id, aplicativo_id) ON DELETE RESTRICT;
ALTER TABLE olist_sync_pendencia
  ADD CONSTRAINT olist_sync_pendencia_status CHECK (status IN ('AGUARDANDO_REVISAO','APROVADA','REJEITADA','IGNORADA','RESOLVIDA')),
  ADD CONSTRAINT olist_sync_pendencia_severidade CHECK (severidade IN ('CRITICA','ALTA','MEDIA','INFORMATIVA'));

-- O agrupamento de configuração é estável. Desabilitar participantes preserva proveniência.
CREATE FUNCTION olist_sync_validar_participante() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE pai uuid; atual uuid; bloqueados uuid[];
BEGIN
  SELECT aplicativo_pai_id, aplicativos_bloqueados INTO pai, bloqueados FROM public.olist_sync_configuracao WHERE id=NEW.configuracao_id;
  SELECT aplicativo_pai_id INTO atual FROM public.aplicativo WHERE id=NEW.aplicativo_id FOR SHARE;
  IF NEW.habilitado AND (atual IS DISTINCT FROM pai OR NEW.aplicativo_id=pai
    OR NEW.aplicativo_id=ANY(bloqueados)) THEN
    RAISE EXCEPTION 'Participante habilitado deve ser filho direto elegível do aplicativo pai' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.configuracao_id<>NEW.configuracao_id OR OLD.aplicativo_id<>NEW.aplicativo_id) THEN
    RAISE EXCEPTION 'A identidade do participante é imutável' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
-- A revogação não impede liberar a janela de chamadas de uma conta em processamento.
CREATE TRIGGER olist_sync_validar_participante BEFORE INSERT OR UPDATE OF configuracao_id,aplicativo_id,habilitado ON olist_sync_participante FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_participante();
CREATE FUNCTION olist_sync_proteger_agrupamento() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.aplicativo_pai_id IS DISTINCT FROM OLD.aplicativo_pai_id THEN
    IF TG_TABLE_NAME='olist_sync_configuracao' OR EXISTS (SELECT 1 FROM public.olist_sync_participante WHERE aplicativo_id=OLD.id AND habilitado) THEN
      RAISE EXCEPTION 'Desabilite a participação na sincronização antes de alterar o agrupamento' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER olist_sync_proteger_agrupamento BEFORE UPDATE OF aplicativo_pai_id ON aplicativo FOR EACH ROW EXECUTE FUNCTION olist_sync_proteger_agrupamento();
CREATE TRIGGER olist_sync_config_pai_imutavel BEFORE UPDATE OF aplicativo_pai_id ON olist_sync_configuracao FOR EACH ROW EXECUTE FUNCTION olist_sync_proteger_agrupamento();
CREATE FUNCTION olist_sync_validar_execucao_escopo() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE grupo uuid;
BEGIN
  IF NEW.execucao_id IS NOT NULL THEN
    SELECT configuracao_id INTO grupo FROM public.olist_sync_execucao WHERE id=NEW.execucao_id;
    IF grupo IS DISTINCT FROM NEW.configuracao_id THEN
      RAISE EXCEPTION 'Execução de outro grupo' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER olist_sync_operacao_escopo BEFORE INSERT OR UPDATE ON olist_sync_operacao FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_execucao_escopo();
CREATE TRIGGER olist_sync_pendencia_escopo BEFORE INSERT OR UPDATE ON olist_sync_pendencia FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_execucao_escopo();
CREATE TRIGGER olist_sync_evento_escopo BEFORE INSERT OR UPDATE ON olist_sync_evento FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_execucao_escopo();
CREATE FUNCTION olist_sync_validar_etapa_escopo() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.aplicativo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.olist_sync_execucao e JOIN public.olist_sync_participante p ON p.configuracao_id=e.configuracao_id
    WHERE e.id=NEW.execucao_id AND p.aplicativo_id=NEW.aplicativo_id
  ) THEN RAISE EXCEPTION 'Etapa de conta fora do grupo' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER olist_sync_etapa_escopo BEFORE INSERT OR UPDATE ON olist_sync_etapa FOR EACH ROW EXECUTE FUNCTION olist_sync_validar_etapa_escopo();

-- Defesa em profundidade: acesso aos dados e credenciais somente pelo servidor.
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['olist_sync_configuracao','olist_sync_participante','olist_sync_registro','olist_sync_estado','olist_sync_execucao','olist_sync_etapa','olist_sync_operacao','olist_sync_pendencia','olist_sync_evento','integracao_olist_tokens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION olist_sync_validar_participante(),olist_sync_proteger_agrupamento(),olist_sync_validar_execucao_escopo(),olist_sync_validar_etapa_escopo() FROM PUBLIC;

-- Seeds são idempotentes; jamais despausam jobs ou concedem permissões a usuários.
INSERT INTO configuracoes_jobs (chave,pausado) VALUES
 ('agendar-sincronizacao-olist',true),('auditar-sincronizacao-olist',true),
 ('aplicar-sincronizacao-olist',true),('limpar-historico-sincronizacao-olist',true)
ON CONFLICT (chave) DO NOTHING;
UPDATE aplicativo a SET jobs=concat_ws(',',nullif(a.jobs,''),(
  SELECT string_agg(flag,',' ORDER BY flag) FROM unnest(ARRAY['AGENDAR_SINCRONIZACAO_OLIST','AUDITAR_SINCRONIZACAO_OLIST','APLICAR_SINCRONIZACAO_OLIST','LIMPAR_HISTORICO_SINCRONIZACAO_OLIST']) flag
  WHERE NOT EXISTS(SELECT 1 FROM regexp_split_to_table(coalesce(a.jobs,''),',') parte WHERE upper(btrim(parte))=flag)
)) WHERE a.id='00000000-0000-0000-0000-000000000002';
-- A exclusão do piloto é dado de configuração; a validação de participantes é genérica.
INSERT INTO olist_sync_configuracao(aplicativo_pai_id,aplicativos_bloqueados)
 SELECT id,ARRAY['00000000-0000-0000-0000-000000000003'::uuid] FROM aplicativo WHERE id='00000000-0000-0000-0000-000000000002'
ON CONFLICT(aplicativo_pai_id) DO NOTHING;
INSERT INTO olist_sync_participante(configuracao_id,aplicativo_id,habilitado)
 SELECT c.id,a.id,true FROM olist_sync_configuracao c JOIN aplicativo a ON a.aplicativo_pai_id=c.aplicativo_pai_id
 WHERE c.aplicativo_pai_id='00000000-0000-0000-0000-000000000002' AND a.id IN ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005')
ON CONFLICT(configuracao_id,aplicativo_id) DO NOTHING;

COMMIT;
