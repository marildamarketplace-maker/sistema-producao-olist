import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { aplicativoTemJob } from "@/lib/aplicativo-jobs";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";
import { transferirAfetadosPendentes } from "@/repositories/olist-sync-cobertura-repository";

export const ESTADOS_EXECUCAO_SYNC_ATIVOS = ["PENDENTE", "AUDITANDO", "APLICANDO", "AGUARDANDO_RETRY"];
export const JOBS_SYNC = {
  agendar: { chave: "agendar-sincronizacao-olist", flag: "AGENDAR_SINCRONIZACAO_OLIST" },
  auditar: { chave: "auditar-sincronizacao-olist", flag: "AUDITAR_SINCRONIZACAO_OLIST" },
  aplicar: { chave: "aplicar-sincronizacao-olist", flag: "APLICAR_SINCRONIZACAO_OLIST" },
  limpar: { chave: "limpar-historico-sincronizacao-olist", flag: "LIMPAR_HISTORICO_SINCRONIZACAO_OLIST" },
} as const;
type Tx = Prisma.TransactionClient;
type JobSync = keyof typeof JOBS_SYNC;
export class ErroRepositorioSync extends Error {
  constructor(message: string, public readonly status = 409) { super(message); this.name = "ErroRepositorioSync"; }
}
export const configuracaoSyncSelect = {
  id: true, aplicativoPaiId: true, aplicativosBloqueados: true, ativo: true, entidades: true, versao: true, politicasJson: true, readinessJson: true,
  horaDiaria: true, timezone: true, proximaExecucaoEm: true, ultimaLimpezaEm: true, autorizadoPor: true, limiteAlteracoes: true,
  createdAt: true, updatedAt: true,
  aplicativoPai: { select: { id: true, jobs: true } },
  participantes: { select: { id: true, aplicativoId: true, habilitado: true, contaIdentidade: true, proximaChamadaEm: true,
    aplicativo: { select: { id: true, nome: true, aplicativoPaiId: true } } }, orderBy: { aplicativoId: "asc" as const } },
} satisfies Prisma.OlistSyncConfiguracaoSelect;
const execucaoSelect = {
  id: true, configuracaoId: true, chaveIdempotencia: true, modo: true, origem: true, completa: true, status: true,
  versaoConfiguracao: true, solicitadoPor: true, iniciadaEm: true, finalizadaEm: true, cancelamentoSolicitado: true,
  contadoresJson: true, erroCodigo: true, createdAt: true, updatedAt: true,
} satisfies Prisma.OlistSyncExecucaoSelect;
const etapaSelect = {
  id: true, execucaoId: true, entidade: true, aplicativoId: true, fase: true, status: true, cursorJson: true,
  tentativas: true, disponivelEm: true, leaseToken: true, leaseAte: true, erroCodigo: true, createdAt: true, updatedAt: true,
  execucao: { select: { ...execucaoSelect, configuracao: { select: configuracaoSyncSelect } } },
} satisfies Prisma.OlistSyncEtapaSelect;
export type ConfiguracaoSync = Prisma.OlistSyncConfiguracaoGetPayload<{ select: typeof configuracaoSyncSelect }>;
export type ReservaEtapaSync = Prisma.OlistSyncEtapaGetPayload<{ select: typeof etapaSelect }> & { leaseToken: string };
// Controle vigente por HTTP: não transfere políticas, agenda, contadores ou
// metadados da execução que não participam da autorização.
const controleEtapaSelect = {
  id: true, execucaoId: true, fase: true, cursorJson: true, leaseToken: true,
  execucao: { select: {
    versaoConfiguracao: true, cancelamentoSolicitado: true, origem: true, solicitadoPor: true,
    configuracao: { select: {
      id: true, aplicativoPaiId: true, aplicativosBloqueados: true, ativo: true, versao: true, readinessJson: true, autorizadoPor: true,
      aplicativoPai: { select: { jobs: true } },
      participantes: { select: { aplicativoId: true, habilitado: true,
        aplicativo: { select: { id: true, aplicativoPaiId: true } } } },
    } },
  } },
} satisfies Prisma.OlistSyncEtapaSelect;
export type ControleEtapaSync = Prisma.OlistSyncEtapaGetPayload<{ select: typeof controleEtapaSelect }> & { leaseToken: string };
const checkpointSelect = {
  id: true, execucaoId: true, cursorJson: true, leaseToken: true, tentativas: true,
  execucao: { select: { cancelamentoSolicitado: true } },
} satisfies Prisma.OlistSyncEtapaSelect;
export type EntradaExecucaoSync = { configuracaoId: string; modo: "AUDITAR" | "AUDITAR_E_APLICAR" | "APLICAR";
  idempotencia: string; solicitadoPor: string | null; origem: "MANUAL" | "AGENDADA"; completa: boolean };

function resolverJob(chave: JobSync | string): (typeof JOBS_SYNC)[JobSync] {
  const encontrado = Object.values(JOBS_SYNC).find(j => j.chave === chave || j.flag === chave) ?? JOBS_SYNC[chave as JobSync];
  if (!encontrado) throw new ErroRepositorioSync("Job de sincronização inválido.", 400);
  return encontrado;
}
async function disponibilidade(db: Pick<Tx, "olistSyncConfiguracao" | "configuracaoJob">, configuracaoId: string, chave: JobSync | string) {
  const job = resolverJob(chave);
  const [config, global] = await Promise.all([
    db.olistSyncConfiguracao.findUnique({ where: { id: configuracaoId }, select: configuracaoSyncSelect }),
    db.configuracaoJob.findUnique({ where: { chave: job.chave }, select: { pausado: true } }),
  ]);
  const membros = config?.participantes.filter(p => p.habilitado) ?? [];
  const motivo = !config ? "Configuração não encontrada." :
    !global || global.pausado ? "Este job está pausado na configuração global." :
      !aplicativoTemJob(config.aplicativoPai.jobs, job.flag) ? "Job não autorizado no aplicativo pai." :
        job.chave === JOBS_SYNC.limpar.chave ? null : !config.ativo ? "Sincronização desabilitada para o grupo." :
          membros.length < 2 || membros.some(p => !aplicativoElegivelSync(config, p.aplicativo))
            ? "O grupo precisa de pelo menos dois filhos diretos habilitados." : null;
  return { habilitado: motivo === null, motivo, configuracao: config };
}
async function exigirUsuario(tx: Pick<Tx, "usuario">, configuracao: ConfiguracaoSync, usuarioId: string | null, origem: string) {
  const id = origem === "AGENDADA" ? configuracao.autorizadoPor : usuarioId;
  if (!id || !await tx.usuario.findFirst({ where: { id, aplicativoId: configuracao.aplicativoPaiId, ativo: true,
    ...(origem === "AGENDADA" ? { podeConfigurarSincronizacaoOlist: true } : { podeExecutarSincronizacaoOlist: true }) }, select: { id: true } })) {
    throw new ErroRepositorioSync("A autorização do responsável não está mais válida.", 403);
  }
}
const liberacao = { leaseToken: null, leaseAte: null };

// Mesmo critério de aplicativoElegivelSync, aplicado no banco sem carregar contas.
// Reutilizado para reservar e encerrar trabalhos que perderam a elegibilidade.
const grupoInelegivel = Prisma.sql`(
  (SELECT count(*) FROM olist_sync_participante p WHERE p.configuracao_id=c.id AND p.habilitado)<2
  OR EXISTS(SELECT 1 FROM olist_sync_participante p JOIN aplicativo filho ON filho.id=p.aplicativo_id
    WHERE p.configuracao_id=c.id AND p.habilitado
      AND (p.aplicativo_id=c.aplicativo_pai_id OR filho.aplicativo_pai_id IS DISTINCT FROM c.aplicativo_pai_id OR p.aplicativo_id=ANY(c.aplicativos_bloqueados)))
)`;

// O SQL replica os mesmos gates do aceite. Nenhum token parcial em aplicativo.jobs concede acesso.
const gateReserva = Prisma.sql`
  c.ativo AND c.versao=e.versao_configuracao AND NOT e.cancelamento_solicitado
  AND e.status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY')
  AND EXISTS(SELECT 1 FROM configuracoes_jobs j WHERE j.chave=CASE WHEN s.fase='APLICAR' THEN 'aplicar-sincronizacao-olist' ELSE 'auditar-sincronizacao-olist' END AND NOT j.pausado)
  AND EXISTS(SELECT 1 FROM regexp_split_to_table(coalesce(a.jobs,''),',') f WHERE upper(btrim(f))=CASE WHEN s.fase='APLICAR' THEN 'APLICAR_SINCRONIZACAO_OLIST' ELSE 'AUDITAR_SINCRONIZACAO_OLIST' END)
  AND NOT ${grupoInelegivel}
  AND (s.aplicativo_id IS NULL OR EXISTS(SELECT 1 FROM olist_sync_participante p WHERE p.configuracao_id=c.id AND p.aplicativo_id=s.aplicativo_id AND p.habilitado))
  AND EXISTS(SELECT 1 FROM usuario u WHERE u.id=CASE WHEN e.origem='AGENDADA' THEN c.autorizado_por ELSE e.solicitado_por END
    AND u.aplicativo_id=c.aplicativo_pai_id AND u.ativo
    AND CASE WHEN e.origem='AGENDADA' THEN u.pode_configurar_sincronizacao_olist ELSE u.pode_executar_sincronizacao_olist END)
`;

// O grupo e a etapa precisam usar a mesma elegibilidade. Escolher primeiro um
// grupo com conta em espera escondia trabalho pronto em outros grupos.
const etapaElegivel = (agora: Date) => Prisma.sql`
  ${gateReserva} AND s.tentativas<5
  AND ((s.status IN ('PENDENTE','AGUARDANDO_RETRY') AND s.disponivel_em<=${agora}) OR (s.status='PROCESSANDO' AND s.lease_ate<=${agora}))
  AND (s.aplicativo_id IS NULL OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.id<>s.id AND outra.aplicativo_id=s.aplicativo_id AND outra.status='PROCESSANDO' AND outra.lease_ate>${agora}))
  AND (s.aplicativo_id IS NULL OR (SELECT count(*) FROM olist_sync_etapa outra JOIN olist_sync_execucao oe ON oe.id=outra.execucao_id WHERE oe.configuracao_id=c.id AND outra.id<>s.id AND outra.status='PROCESSANDO' AND outra.lease_ate>${agora})<2)
  AND (s.fase<>'COMPARAR' OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.execucao_id=e.id AND outra.entidade=s.entidade AND outra.fase IN ('LISTAR','DETALHAR') AND outra.status<>'CONCLUIDA'))
  AND (s.fase<>'APLICAR' OR e.modo='APLICAR' OR EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.execucao_id=e.id AND outra.entidade=s.entidade AND outra.fase='COMPARAR' AND outra.status='CONCLUIDA'))
  AND (s.aplicativo_id IS NULL OR NOT EXISTS(SELECT 1 FROM olist_sync_participante p WHERE p.configuracao_id=c.id AND p.aplicativo_id=s.aplicativo_id AND p.proxima_chamada_em>${agora}))
`;
const aplicacaoPausada = Prisma.sql`
  (NOT EXISTS(SELECT 1 FROM configuracoes_jobs j WHERE j.chave='aplicar-sincronizacao-olist' AND NOT j.pausado)
    OR NOT EXISTS(SELECT 1 FROM regexp_split_to_table(coalesce(a.jobs,''),',') f WHERE upper(btrim(f))='APLICAR_SINCRONIZACAO_OLIST'))
`;

export function criarOlistSyncRepository(db: PrismaClient) {
  async function sobReserva<T, Atual extends { leaseToken: string | null }>(
    reserva: Pick<ReservaEtapaSync, "id" | "leaseToken">,
    carregar: (tx: Tx) => Promise<Atual>,
    executar: (tx: Tx, atual: Atual & { leaseToken: string }) => Promise<T>,
  ) {
    return db.$transaction(async tx => {
      // Ordem compartilhada por reserva, cancelamento e persistência: execução
      // antes da etapa. Serializa também a criação da próxima fase sem manter
      // locks durante chamadas à Olist.
      const execucao = await tx.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM olist_sync_execucao e JOIN olist_sync_etapa s ON s.execucao_id=e.id
        WHERE s.id=${reserva.id}::uuid AND s.lease_token=${reserva.leaseToken}::uuid
          AND s.lease_ate>clock_timestamp() AND s.status='PROCESSANDO' FOR UPDATE OF e`;
      if (!execucao.length) return null;
      const valida = await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM olist_sync_etapa s
        WHERE s.id=${reserva.id}::uuid AND s.lease_token=${reserva.leaseToken}::uuid AND s.lease_ate>clock_timestamp()
          AND s.status='PROCESSANDO' FOR UPDATE OF s`;
      if (!valida.length) return null;
      const atual = await carregar(tx);
      if (atual.leaseToken !== reserva.leaseToken) return null;
      return executar(tx, { ...atual, leaseToken: reserva.leaseToken });
    }, { timeout: 25_000, maxWait: 5_000 });
  }
  function comReserva<T>(reserva: Pick<ReservaEtapaSync, "id" | "leaseToken">, executar: (tx: Tx, atual: ReservaEtapaSync) => Promise<T>) {
    return sobReserva(reserva, tx => tx.olistSyncEtapa.findUniqueOrThrow({ where: { id: reserva.id }, select: etapaSelect }), executar);
  }
  function comControle<T>(reserva: Pick<ReservaEtapaSync, "id" | "leaseToken">, executar: (tx: Tx, atual: ControleEtapaSync) => Promise<T>) {
    return sobReserva(reserva, tx => tx.olistSyncEtapa.findUniqueOrThrow({ where: { id: reserva.id }, select: controleEtapaSelect }), executar);
  }
  function comCheckpoint<T>(reserva: Pick<ReservaEtapaSync, "id" | "leaseToken">,
    executar: (tx: Tx, atual: Prisma.OlistSyncEtapaGetPayload<{ select: typeof checkpointSelect }>) => Promise<T>) {
    return sobReserva(reserva, tx => tx.olistSyncEtapa.findUniqueOrThrow({ where: { id: reserva.id }, select: checkpointSelect }), executar);
  }
  async function concluirExecucaoQuandoPossivel(id: string) {
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM olist_sync_execucao WHERE id=${id}::uuid FOR UPDATE`;
      const e = await tx.olistSyncExecucao.findUnique({ where: { id }, select: execucaoSelect });
      if (!e || !ESTADOS_EXECUCAO_SYNC_ATIVOS.includes(e.status)) return e;
      const pendentes = await tx.olistSyncEtapa.count({ where: { execucaoId: id, status: { in: ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"] } } });
      if (pendentes) return e;
      const [falhas, bloqueadas, propostas, pausadas] = await Promise.all([
        tx.olistSyncEtapa.count({ where: { execucaoId: id, status: "FALHOU" } }),
        tx.olistSyncPendencia.count({ where: { configuracaoId: e.configuracaoId, status: "AGUARDANDO_REVISAO" } }),
        tx.olistSyncOperacao.count({ where: { configuracaoId: e.configuracaoId, status: { in: ["PROPOSTA", "AUTORIZADA", "EM_APLICACAO", "VERIFICANDO", "RESULTADO_INCONCLUSIVO"] } } }),
        tx.olistSyncEtapa.count({ where: { execucaoId: id, status: "PAUSADA" } }),
      ]);
      return tx.olistSyncExecucao.update({ where: { id }, data: { status: e.cancelamentoSolicitado ? "CANCELADA" : falhas || bloqueadas || propostas || pausadas ? "CONCLUIDA_COM_PENDENCIAS" : "CONCLUIDA", finalizadaEm: new Date() }, select: execucaoSelect });
    });
  }
  const repo = {
    comReserva,
    comControle,
    concluirExecucaoQuandoPossivel,
    disponibilidade: (configuracaoId: string, chave: JobSync | string) => disponibilidade(db, configuracaoId, chave),
    obterConfiguracao: (aplicativoPaiId: string) => db.olistSyncConfiguracao.findUnique({ where: { aplicativoPaiId }, select: configuracaoSyncSelect }),
    async enfileirar(entrada: EntradaExecucaoSync, transacao?: Tx) {
      const executar = async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM olist_sync_configuracao WHERE id=${entrada.configuracaoId}::uuid FOR UPDATE`;
        const anterior = await tx.olistSyncExecucao.findUnique({ where: { configuracaoId_chaveIdempotencia: { configuracaoId: entrada.configuracaoId, chaveIdempotencia: entrada.idempotencia } }, select: execucaoSelect });
        if (anterior) {
          if (anterior.modo !== entrada.modo || anterior.completa !== entrada.completa || anterior.origem !== entrada.origem || anterior.solicitadoPor !== entrada.solicitadoPor)
            throw new ErroRepositorioSync("A chave de idempotência já foi usada com outra solicitação.");
          return anterior;
        }
        const disponivel = await disponibilidade(tx, entrada.configuracaoId, entrada.modo === "APLICAR" ? "aplicar" : "auditar");
        if (!disponivel.habilitado || !disponivel.configuracao) throw new ErroRepositorioSync(disponivel.motivo ?? "Job indisponível.", 503);
        const c = disponivel.configuracao;
        if (entrada.modo === "APLICAR" && !c.entidades.some(e => ["PRODUTO", "CONTATO"].includes(e)))
          throw new ErroRepositorioSync("Não há entidades habilitadas que suportem aplicação de alterações.");
        await exigirUsuario(tx, c, entrada.solicitadoPor, entrada.origem);
        if (entrada.origem === "AGENDADA") {
          const agenda = await disponibilidade(tx, c.id, "agendar");
          if (!agenda.habilitado) throw new ErroRepositorioSync(agenda.motivo!, 503);
        }
        if (await tx.olistSyncExecucao.findFirst({ where: { configuracaoId: c.id, status: { in: ESTADOS_EXECUCAO_SYNC_ATIVOS } }, select: { id: true } }))
          throw new ErroRepositorioSync("Já existe uma execução ativa neste grupo.");
        const execucao = await tx.olistSyncExecucao.create({ data: { configuracaoId: c.id, chaveIdempotencia: entrada.idempotencia, modo: entrada.modo,
          origem: entrada.origem, solicitadoPor: entrada.solicitadoPor, completa: entrada.completa, versaoConfiguracao: c.versao }, select: execucaoSelect });
        await tx.olistSyncEtapa.createMany({ data: c.entidades.filter(entidade => entrada.modo !== "APLICAR" || ["PRODUTO", "CONTATO"].includes(entidade))
          .flatMap(entidade => c.participantes.filter(p => p.habilitado).map(p => ({ execucaoId: execucao.id, entidade, aplicativoId: p.aplicativoId, fase: entrada.modo === "APLICAR" ? "APLICAR" : "LISTAR" }))) });
        if (entrada.modo !== "APLICAR") await transferirAfetadosPendentes(tx, { grupo: c.id, execucao: execucao.id, entidades: c.entidades });
        return execucao;
      };
      return transacao ? executar(transacao) : db.$transaction(executar, { timeout: 25_000, maxWait: 5_000 });
    },
    async reservarEtapa({ agora = new Date(), leaseMs = 180_000, recuperar = true }: { agora?: Date; leaseMs?: number; recuperar?: boolean } = {}): Promise<ReservaEtapaSync | null> {
      if (!Number.isInteger(leaseMs) || leaseMs < 30_000 || leaseMs > 180_000) throw new ErroRepositorioSync("Duração de reserva inválida.", 400);
      // Cancelamento, alteração do grupo e revogação de autorização não podem deixar
      // uma execução sem consumidor bloqueando para sempre as auditorias seguintes.
      if (recuperar) {
        await db.$transaction(async tx => {
          const encerradas = await tx.$queryRaw<{ id: string; motivo: string }[]>`
            SELECT e.id, CASE WHEN e.cancelamento_solicitado THEN 'CANCELADA'
              WHEN NOT c.ativo OR c.versao<>e.versao_configuracao OR ${grupoInelegivel} THEN 'CONFIGURACAO_ALTERADA'
              ELSE 'AUTORIZACAO_REVOGADA' END AS motivo
            FROM olist_sync_execucao e JOIN olist_sync_configuracao c ON c.id=e.configuracao_id
            WHERE e.status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY')
              AND NOT EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=e.id AND s.status='PROCESSANDO' AND s.lease_ate>${agora})
              AND (e.cancelamento_solicitado OR NOT c.ativo OR c.versao<>e.versao_configuracao OR ${grupoInelegivel}
                OR NOT EXISTS(SELECT 1 FROM usuario u WHERE u.id=CASE WHEN e.origem='AGENDADA' THEN c.autorizado_por ELSE e.solicitado_por END
                  AND u.aplicativo_id=c.aplicativo_pai_id AND u.ativo
                  AND CASE WHEN e.origem='AGENDADA' THEN u.pode_configurar_sincronizacao_olist ELSE u.pode_executar_sincronizacao_olist END))
            ORDER BY e.created_at,e.id LIMIT 20 FOR UPDATE OF e SKIP LOCKED`;
          for (const e of encerradas) {
            await tx.olistSyncOperacao.updateMany({ where: { execucaoId: e.id, status: { in: ["EM_APLICACAO", "VERIFICANDO"] } }, data: { status: "RESULTADO_INCONCLUSIVO", erroCodigo: e.motivo } });
            await tx.olistSyncEtapa.updateMany({ where: { execucaoId: e.id, status: { in: ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"] } }, data: { ...liberacao, status: e.motivo === "CANCELADA" ? "CANCELADA" : "PAUSADA", erroCodigo: e.motivo } });
            await tx.olistSyncExecucao.update({ where: { id: e.id }, data: { status: e.motivo === "CANCELADA" ? "CANCELADA" : "CONCLUIDA_COM_PENDENCIAS", erroCodigo: e.motivo, finalizadaEm: agora }, select: { id: true } });
          }
        }, { timeout: 25_000, maxWait: 5_000 });
        // Recuperação independe dos gates de consumo: uma lease esgotada ou uma
        // aplicação pausada não pode impedir o fechamento e bloquear o grupo.
        await db.$transaction(async tx => {
          const execucoes = await tx.$queryRaw<{ id: string }[]>`
            SELECT e.id FROM olist_sync_execucao e JOIN olist_sync_configuracao c ON c.id=e.configuracao_id
              JOIN aplicativo a ON a.id=c.aplicativo_pai_id
            WHERE e.status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY')
              AND EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=e.id
                AND ((s.status='PROCESSANDO' AND s.lease_ate<=${agora} AND s.tentativas>=5)
                  OR (s.fase='APLICAR' AND ${aplicacaoPausada}
                    AND (s.status IN ('PENDENTE','AGUARDANDO_RETRY') OR (s.status='PROCESSANDO' AND s.lease_ate<=${agora})))))
            ORDER BY e.created_at,e.id LIMIT 20 FOR UPDATE OF e SKIP LOCKED`;
          for (const e of execucoes) {
            await tx.$executeRaw`UPDATE olist_sync_operacao o SET status='RESULTADO_INCONCLUSIVO',erro_codigo='RESERVA_EXPIRADA',updated_at=now()
              WHERE o.execucao_id=${e.id}::uuid AND o.status IN ('EM_APLICACAO','VERIFICANDO')
                AND EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=o.execucao_id AND s.aplicativo_id=o.destino_app_id
                  AND s.fase='APLICAR' AND s.status='PROCESSANDO' AND s.lease_ate<=${agora})`;
            await tx.$executeRaw`UPDATE olist_sync_etapa s SET status='FALHOU',erro_codigo='TENTATIVAS_ESGOTADAS',lease_token=NULL,lease_ate=NULL,updated_at=now()
              WHERE s.execucao_id=${e.id}::uuid AND s.status='PROCESSANDO' AND s.lease_ate<=${agora} AND s.tentativas>=5`;
            await tx.$executeRaw`UPDATE olist_sync_etapa s SET status='PAUSADA',lease_token=NULL,lease_ate=NULL,updated_at=now()
              FROM olist_sync_execucao e,olist_sync_configuracao c,aplicativo a
              WHERE s.execucao_id=${e.id}::uuid AND s.execucao_id=e.id AND c.id=e.configuracao_id AND a.id=c.aplicativo_pai_id
                AND s.fase='APLICAR' AND ${aplicacaoPausada}
                AND (s.status IN ('PENDENTE','AGUARDANDO_RETRY') OR (s.status='PROCESSANDO' AND s.lease_ate<=${agora}))`;
          }
        }, { timeout: 25_000, maxWait: 5_000 });
        const finalizaveis = await db.olistSyncExecucao.findMany({ where: { status: { in: ESTADOS_EXECUCAO_SYNC_ATIVOS }, etapas: { some: { status: { in: ["PAUSADA", "FALHOU"] } }, none: { status: { in: ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"] } } } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 });
        for (const e of finalizaveis) await concluirExecucaoQuandoPossivel(e.id);
      }
      const leaseToken = randomUUID();
      return db.$transaction(async tx => {
        // Lock da configuração serializa a seleção entre workers e limita duas contas por grupo.
        const candidatos = await tx.$queryRaw<{ id: string }[]>`
          SELECT c.id FROM olist_sync_configuracao c JOIN aplicativo a ON a.id=c.aplicativo_pai_id
          WHERE EXISTS(SELECT 1 FROM olist_sync_etapa s JOIN olist_sync_execucao e ON e.id=s.execucao_id
            WHERE e.configuracao_id=c.id AND ${etapaElegivel(agora)})
          ORDER BY c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`;
        if (!candidatos[0]) return null;
        const configuracaoId = candidatos[0].id;
        await tx.$queryRaw`SELECT id FROM olist_sync_execucao WHERE configuracao_id=${configuracaoId}::uuid
          AND status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY') ORDER BY id FOR UPDATE`;
        await tx.$executeRaw`UPDATE olist_sync_operacao o SET status='RESULTADO_INCONCLUSIVO',erro_codigo='RESERVA_EXPIRADA',updated_at=now()
          WHERE o.configuracao_id=${configuracaoId}::uuid AND o.status IN ('EM_APLICACAO','VERIFICANDO')
          AND EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=o.execucao_id AND s.aplicativo_id=o.destino_app_id AND s.fase='APLICAR' AND s.status='PROCESSANDO' AND s.lease_ate<=${agora})`;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          WITH candidato AS (
            SELECT s.id FROM olist_sync_etapa s JOIN olist_sync_execucao e ON e.id=s.execucao_id
              JOIN olist_sync_configuracao c ON c.id=e.configuracao_id JOIN aplicativo a ON a.id=c.aplicativo_pai_id
            WHERE c.id=${configuracaoId}::uuid AND ${etapaElegivel(agora)}
            ORDER BY s.disponivel_em,s.created_at,s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED
          ) UPDATE olist_sync_etapa s SET status='PROCESSANDO',lease_token=${leaseToken}::uuid,lease_ate=${new Date(agora.getTime() + leaseMs)},tentativas=tentativas+1,updated_at=now()
            FROM candidato x WHERE s.id=x.id RETURNING s.id`;
        if (!rows[0]) return null;
        const etapa = await tx.olistSyncEtapa.findUniqueOrThrow({ where: { id: rows[0].id }, select: etapaSelect });
        await tx.olistSyncExecucao.update({ where: { id: etapa.execucaoId }, data: { status: etapa.fase === "APLICAR" ? "APLICANDO" : "AUDITANDO", iniciadaEm: etapa.execucao.iniciadaEm ?? agora }, select: { id: true } });
        return { ...etapa, leaseToken };
      }, { timeout: 25_000, maxWait: 5_000 });
    },
    async proximaJanelaEtapa({ agora = new Date(), limiteMs = 12_000 }: { agora?: Date; limiteMs?: number } = {}): Promise<Date | null> {
      if (!Number.isInteger(limiteMs) || limiteMs < 0 || limiteMs > 12_000) throw new ErroRepositorioSync("Janela de espera inválida.", 400);
      const limite = new Date(agora.getTime() + limiteMs);
      const rows = await db.$queryRaw<{ disponivel: Date }[]>`
        SELECT greatest(s.disponivel_em,coalesce(p.proxima_chamada_em,${agora})) AS disponivel
        FROM olist_sync_etapa s JOIN olist_sync_execucao e ON e.id=s.execucao_id
          JOIN olist_sync_configuracao c ON c.id=e.configuracao_id JOIN aplicativo a ON a.id=c.aplicativo_pai_id
          LEFT JOIN olist_sync_participante p ON p.configuracao_id=c.id AND p.aplicativo_id=s.aplicativo_id
        WHERE ${gateReserva} AND s.status IN ('PENDENTE','AGUARDANDO_RETRY') AND s.tentativas<5
          AND s.disponivel_em<=${limite} AND (p.proxima_chamada_em IS NULL OR p.proxima_chamada_em<=${limite})
          AND (s.aplicativo_id IS NULL OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.aplicativo_id=s.aplicativo_id AND outra.status='PROCESSANDO' AND outra.lease_ate>${agora}))
          AND (s.aplicativo_id IS NULL OR (SELECT count(*) FROM olist_sync_etapa outra JOIN olist_sync_execucao oe ON oe.id=outra.execucao_id WHERE oe.configuracao_id=c.id AND outra.status='PROCESSANDO' AND outra.lease_ate>${agora})<2)
          AND (s.fase<>'COMPARAR' OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.execucao_id=e.id AND outra.entidade=s.entidade AND outra.fase IN ('LISTAR','DETALHAR') AND outra.status<>'CONCLUIDA'))
          AND (s.fase<>'APLICAR' OR e.modo='APLICAR' OR EXISTS(SELECT 1 FROM olist_sync_etapa outra WHERE outra.execucao_id=e.id AND outra.entidade=s.entidade AND outra.fase='COMPARAR' AND outra.status='CONCLUIDA'))
        ORDER BY disponivel,s.id LIMIT 1`;
      return rows[0]?.disponivel ?? null;
    },
    async salvarCheckpoint(entrada: { etapaId: string; leaseToken: string; cursor: Prisma.InputJsonValue; status?: string; contadores?: Prisma.InputJsonObject; disponivelEm?: Date; fase?: string }) {
      return comCheckpoint({ id: entrada.etapaId, leaseToken: entrada.leaseToken }, async (tx, atual) => {
        const anterior=atual.cursorJson, cursor=entrada.cursor;
        const cota=anterior && typeof anterior==="object" && !Array.isArray(anterior) ? anterior.cotaLeitura : undefined;
        const checkpoint=cota && cursor && typeof cursor==="object" && !Array.isArray(cursor) ? {...cursor,cotaLeitura:cota} : cursor;
        await tx.olistSyncEtapa.update({ where: { id: atual.id }, data: { ...liberacao, cursorJson: checkpoint, status: atual.execucao.cancelamentoSolicitado ? "CANCELADA" : entrada.status ?? "PENDENTE",
          tentativas: 0, erroCodigo: null, disponivelEm: entrada.disponivelEm ?? new Date(), ...(entrada.fase ? { fase: entrada.fase } : {}) }, select: { id: true } });
        if (entrada.contadores) await tx.olistSyncExecucao.update({ where: { id: atual.execucaoId }, data: { contadoresJson: entrada.contadores }, select: { id: true } });
        return true;
      });
    },
    async falharEtapa(reserva: Pick<ReservaEtapaSync, "id" | "leaseToken">, codigo: string, atrasoMs: number | null) {
      if (!/^[A-Z0-9_]{1,80}$/.test(codigo)) throw new ErroRepositorioSync("Código de erro inválido.", 400);
      return comCheckpoint(reserva, async (tx, atual) => {
        const retry = !atual.execucao.cancelamentoSolicitado && atrasoMs !== null && atual.tentativas < 5;
        await tx.olistSyncEtapa.update({ where: { id: atual.id }, data: { ...liberacao, status: atual.execucao.cancelamentoSolicitado ? "CANCELADA" : retry ? "AGUARDANDO_RETRY" : "FALHOU", erroCodigo: codigo,
          disponivelEm: new Date(Date.now() + (retry ? Math.min(Math.max(atrasoMs!, 1000), 3_600_000) : 0)) }, select: { id: true } });
        return true;
      });
    },
    async cancelarExecucao(id: string, aplicativoPaiId: string) {
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT c.id FROM olist_sync_configuracao c JOIN olist_sync_execucao e ON e.configuracao_id=c.id WHERE e.id=${id}::uuid AND c.aplicativo_pai_id=${aplicativoPaiId}::uuid FOR UPDATE OF c`;
        await tx.$queryRaw`SELECT e.id FROM olist_sync_execucao e JOIN olist_sync_configuracao c ON c.id=e.configuracao_id
          WHERE e.id=${id}::uuid AND c.aplicativo_pai_id=${aplicativoPaiId}::uuid FOR UPDATE OF e`;
        const atual = await tx.olistSyncExecucao.findFirst({ where: { id, configuracao: { aplicativoPaiId } }, select: execucaoSelect });
        if (!atual) throw new ErroRepositorioSync("Execução não encontrada.", 404);
        if (!ESTADOS_EXECUCAO_SYNC_ATIVOS.includes(atual.status)) return atual;
        const agora = new Date();
        await tx.$executeRaw`UPDATE olist_sync_operacao o SET status='RESULTADO_INCONCLUSIVO',erro_codigo='CANCELADA',updated_at=now()
          WHERE o.execucao_id=${id}::uuid AND o.status IN ('EM_APLICACAO','VERIFICANDO')
            AND NOT EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=o.execucao_id AND s.aplicativo_id=o.destino_app_id
              AND s.fase='APLICAR' AND s.status='PROCESSANDO' AND s.lease_ate>${agora})`;
        await tx.olistSyncEtapa.updateMany({ where: { execucaoId: id, OR: [{ status: { in: ["PENDENTE", "AGUARDANDO_RETRY"] } }, { status: "PROCESSANDO", leaseAte: { lte: agora } }] }, data: { ...liberacao, status: "CANCELADA" } });
        const emVoo = await tx.olistSyncEtapa.count({ where: { execucaoId: id, status: "PROCESSANDO", leaseAte: { gt: agora } } });
        return tx.olistSyncExecucao.update({ where: { id }, data: { cancelamentoSolicitado: true, ...(emVoo ? {} : { status: "CANCELADA", finalizadaEm: agora }) }, select: execucaoSelect });
      });
    },
    async retomarExecucao(id: string, aplicativoPaiId: string, usuarioId: string, idempotencia: string) {
      const anterior = await db.olistSyncExecucao.findFirst({ where: { id, configuracao: { aplicativoPaiId } }, select: execucaoSelect });
      if (!anterior) throw new ErroRepositorioSync("Execução não encontrada.", 404);
      if (ESTADOS_EXECUCAO_SYNC_ATIVOS.includes(anterior.status)) throw new ErroRepositorioSync("A execução ainda está ativa.");
      // Retomar preserva a coleta do contrato original. Propostas antigas e
      // respostas incertas serão revalidadas/reconciliadas pelo consumidor.
      // A nova coleta usa apenas watermarks confirmados; offsets antigos não são copiados.
      const modo = anterior.modo === "APLICAR" ? "APLICAR" : anterior.modo === "AUDITAR_E_APLICAR" ? "AUDITAR_E_APLICAR" : "AUDITAR";
      return repo.enfileirar({ configuracaoId: anterior.configuracaoId, modo, completa: anterior.completa, origem: "MANUAL", solicitadoPor: usuarioId, idempotencia });
    },
    async limparHistorico(configuracaoId: string, agora = new Date()) {
      const liberado = await disponibilidade(db, configuracaoId, "limpar");
      if (!liberado.habilitado) return { executada: false, removidos: 0 };
      // DELETE limitado por IDs: evita transferir payload e evita transações enormes.
      return db.$transaction(async tx => {
        let removidos = 0;
        const corte = (dias: number) => new Date(agora.getTime() - dias * 86_400_000);
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_evento WHERE id IN (SELECT id FROM olist_sync_evento WHERE configuracao_id=${configuracaoId}::uuid AND created_at<${corte(30)} AND tipo NOT IN ('DECISAO_HUMANA','ORIGEM_DECLARADA','ORIGEM_CORRIGIDA') ORDER BY created_at,id LIMIT 500)`;
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_evento WHERE id IN (SELECT id FROM olist_sync_evento WHERE configuracao_id=${configuracaoId}::uuid AND created_at<${corte(365)} AND tipo IN ('DECISAO_HUMANA','ORIGEM_DECLARADA','ORIGEM_CORRIGIDA') ORDER BY created_at,id LIMIT 500)`;
        await tx.$executeRaw`UPDATE olist_sync_operacao SET payload_criptografado=NULL,resultado_criptografado=NULL WHERE id IN (SELECT id FROM olist_sync_operacao WHERE configuracao_id=${configuracaoId}::uuid AND status IN ('CONFIRMADA','OBSOLETA','FALHA_PERMANENTE') AND updated_at<${corte(30)} AND (payload_criptografado IS NOT NULL OR resultado_criptografado IS NOT NULL) ORDER BY updated_at,id LIMIT 500)`;
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_operacao WHERE id IN (SELECT id FROM olist_sync_operacao WHERE configuracao_id=${configuracaoId}::uuid AND status IN ('CONFIRMADA','OBSOLETA','FALHA_PERMANENTE') AND updated_at<${corte(90)} ORDER BY updated_at,id LIMIT 500)`;
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_pendencia WHERE id IN (SELECT id FROM olist_sync_pendencia WHERE configuracao_id=${configuracaoId}::uuid AND status<>'AGUARDANDO_REVISAO' AND decidido_em<${corte(365)} ORDER BY decidido_em,id LIMIT 500)`;
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_afetado WHERE id IN (SELECT f.id FROM olist_sync_afetado f
          WHERE f.configuracao_id=${configuracaoId}::uuid AND f.processado_em IS NOT NULL AND f.processado_em<${corte(90)}
            AND EXISTS(SELECT 1 FROM olist_sync_etapa s WHERE s.execucao_id=f.execucao_id AND s.entidade=f.entidade AND s.fase='COMPARAR' AND s.status='CONCLUIDA')
          ORDER BY f.processado_em,f.id LIMIT 500)`;
        removidos += await tx.$executeRaw`DELETE FROM olist_sync_execucao WHERE id IN (SELECT id FROM olist_sync_execucao e WHERE configuracao_id=${configuracaoId}::uuid AND status IN ('CONCLUIDA','CONCLUIDA_COM_PENDENCIAS','FALHOU','CANCELADA') AND finalizada_em<${corte(90)}
          AND NOT EXISTS(SELECT 1 FROM olist_sync_operacao o WHERE o.execucao_id=e.id AND o.status IN ('PROPOSTA','AUTORIZADA','EM_APLICACAO','VERIFICANDO','RESULTADO_INCONCLUSIVO'))
          AND NOT EXISTS(SELECT 1 FROM olist_sync_afetado f WHERE f.execucao_id=e.id)
          AND NOT EXISTS(SELECT 1 FROM olist_sync_pendencia p WHERE p.execucao_id=e.id AND p.status='AGUARDANDO_REVISAO') ORDER BY finalizada_em,id LIMIT 50)`;
        await tx.olistSyncConfiguracao.update({ where: { id: configuracaoId }, data: { ultimaLimpezaEm: agora }, select: { id: true } });
        return { executada: true, removidos };
      }, { timeout: 25_000, maxWait: 5_000 });
    },
  };
  return repo;
}
export type OlistSyncRepository = ReturnType<typeof criarOlistSyncRepository>;
