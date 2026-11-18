import { Prisma } from "@prisma/client";
import { CAPACIDADES_SYNC, FalhaSync, type EntidadeSync } from "@/lib/olist-sync/contrato";
import { assinaturaEscopoSync, formatarDesdeIncremental, fusoIncrementalValido, INTERVALO_COMPLETA_MS, lerPlanoColeta,
  SOBREPOSICAO_INCREMENTAL_MS, VERSAO_CONTRATO_INCREMENTAL, type PlanoColetaSync } from "@/lib/olist-sync/incremental";
import { objetoJson } from "@/lib/olist-sync/validacao";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";

type Tx = Prisma.TransactionClient;
export type EntradaPlanoColetaSync = {
  grupo: string; execucao: string; aplicativoId: string; entidade: EntidadeSync; participantesIds: readonly string[];
  contaIdentidade: string; completa: boolean; incrementalHabilitado: boolean; iniciadaEm: Date; versaoConfiguracao: number;
};
const coberturaSelect = { id: true, contaIdentidade: true, assinaturaEscopo: true, versaoContrato: true, completaExecucaoId: true,
  completaIniciadaEm: true, completaEm: true, watermarkConfirmado: true, ultimaExecucaoId: true, geracao: true,
  incrementalValidado: true, incrementalFuso: true, incrementalContaIdentidade: true, incrementalVersaoContrato: true } as const;
const chaveCobertura = (e: Pick<EntradaPlanoColetaSync, "grupo" | "aplicativoId" | "entidade">) => ({
  configuracaoId_aplicativoId_entidade: { configuracaoId: e.grupo, aplicativoId: e.aplicativoId, entidade: e.entidade },
});

/** Adota somente uma completa legada cujas etapas e snapshots ainda comprovam a coleta. */
export async function adotarCoberturaLegada(tx: Tx, entrada: EntradaPlanoColetaSync): Promise<boolean> {
  // O contrato antigo descartava os tipos locais. Não há evidência suficiente
  // para reconstruir suas equivalências sem um novo GET completo do contato.
  if (entrada.entidade === "CONTATO") return false;
  const cobertura = await tx.olistSyncCobertura.findUnique({ where: chaveCobertura(entrada), select: coberturaSelect });
  if (!cobertura || cobertura.completaEm || cobertura.watermarkConfirmado || cobertura.geracao !== 0) return false;
  const anterior = await tx.olistSyncExecucao.findFirst({ where: { configuracaoId: entrada.grupo, id: { not: entrada.execucao },
    completa: true, modo: { in: ["AUDITAR", "AUDITAR_E_APLICAR"] }, versaoConfiguracao: entrada.versaoConfiguracao,
    status: { in: ["CONCLUIDA", "CONCLUIDA_COM_PENDENCIAS"] }, cancelamentoSolicitado: false,
    iniciadaEm: { not: null }, finalizadaEm: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, iniciadaEm: true, finalizadaEm: true,
      etapas: { where: { entidade: entrada.entidade, fase: { in: ["LISTAR", "DETALHAR", "COMPARAR"] } },
        select: { fase: true, status: true, aplicativoId: true, cursorJson: true }, take: 42 } } });
  if (!anterior?.iniciadaEm || !anterior.finalizadaEm || anterior.iniciadaEm > entrada.iniciadaEm) return false;
  const coleta = anterior.etapas.filter(s => s.fase !== "COMPARAR");
  if (coleta.length !== entrada.participantesIds.length || coleta.some(s => s.fase !== "DETALHAR" || s.status !== "CONCLUIDA" || !s.aplicativoId || !entrada.participantesIds.includes(s.aplicativoId))
    || !anterior.etapas.some(s => s.fase === "COMPARAR" && s.status === "CONCLUIDA")
    || coleta.some(s => objetoJson(s.cursorJson).plano !== undefined)) return false;
  // Um processamento posterior pode ter sobrescrito os marcadores legados.
  if (await tx.olistSyncExecucao.findFirst({ where: { configuracaoId: entrada.grupo,
    id: { notIn: [anterior.id, entrada.execucao] }, createdAt: { gte: anterior.createdAt } }, select: { id: true } })) return false;
  const incompletos = await tx.$queryRaw<{ quantidade: bigint }[]>`
    SELECT count(*) AS quantidade FROM olist_sync_estado WHERE configuracao_id=${entrada.grupo}::uuid
      AND aplicativo_id=${entrada.aplicativoId}::uuid AND entidade=${entrada.entidade}
      AND (ultima_execucao_id IS DISTINCT FROM ${anterior.id}::uuid OR dados_criptografados IS NULL OR coalesce(metadados_json->>'completo','false')<>'true')`;
  if (Number(incompletos[0]?.quantidade ?? 0) > 0) return false;
  const salva = await tx.olistSyncCobertura.updateMany({ where: { id: cobertura.id, geracao: 0, completaEm: null, watermarkConfirmado: null },
    data: { contaIdentidade: entrada.contaIdentidade, assinaturaEscopo: assinaturaEscopoSync(entrada.entidade, entrada.participantesIds),
      versaoContrato: VERSAO_CONTRATO_INCREMENTAL, completaExecucaoId: anterior.id, completaIniciadaEm: anterior.iniciadaEm,
      completaEm: anterior.finalizadaEm, watermarkConfirmado: anterior.iniciadaEm, ultimaExecucaoId: anterior.id, geracao: 1 } });
  if (salva.count !== 1) return false;
  // A adoção só registra a prova. Não regrava o catálogo na requisição de configuração;
  // a próxima completa registra os marcadores por item durante sua coleta normal.
  return true;
}

export async function selecionarPlanoColeta(tx: Tx, entrada: EntradaPlanoColetaSync): Promise<PlanoColetaSync> {
  if (!entrada.contaIdentidade || !entrada.participantesIds.includes(entrada.aplicativoId) || !Number.isFinite(entrada.iniciadaEm.getTime()))
    throw new FalhaSync("COBERTURA_INVALIDA", "A conta e o início da coleta precisam ser comprovados.");
  await tx.olistSyncCobertura.upsert({ where: chaveCobertura(entrada),
    create: { configuracaoId: entrada.grupo, aplicativoId: entrada.aplicativoId, entidade: entrada.entidade }, update: {}, select: { id: true } });
  await adotarCoberturaLegada(tx, entrada);
  const cobertura = await tx.olistSyncCobertura.findUniqueOrThrow({ where: chaveCobertura(entrada), select: coberturaSelect });
  const assinatura = assinaturaEscopoSync(entrada.entidade, entrada.participantesIds);
  const baseValida = cobertura.completaEm && cobertura.completaIniciadaEm && cobertura.watermarkConfirmado
    && cobertura.completaIniciadaEm <= entrada.iniciadaEm && cobertura.watermarkConfirmado <= entrada.iniciadaEm
    && cobertura.contaIdentidade === entrada.contaIdentidade && cobertura.assinaturaEscopo === assinatura
    && cobertura.versaoContrato === VERSAO_CONTRATO_INCREMENTAL;
  const validacao = cobertura.incrementalValidado && cobertura.incrementalContaIdentidade === entrada.contaIdentidade
    && cobertura.incrementalVersaoContrato === VERSAO_CONTRATO_INCREMENTAL && cobertura.incrementalFuso && fusoIncrementalValido(cobertura.incrementalFuso);
  const incremental = !entrada.completa && entrada.incrementalHabilitado && CAPACIDADES_SYNC[entrada.entidade].incremental
    && baseValida && validacao && entrada.iniciadaEm.getTime() - cobertura.completaEm!.getTime() < INTERVALO_COMPLETA_MS;
  const desdeUtc = incremental ? new Date(cobertura.watermarkConfirmado!.getTime() - SOBREPOSICAO_INCREMENTAL_MS) : null;
  return { modo: incremental ? "INCREMENTAL" : "COMPLETA", iniciadaEm: entrada.iniciadaEm.toISOString(),
    desde: desdeUtc ? formatarDesdeIncremental(desdeUtc, cobertura.incrementalFuso!) : null, desdeUtc: desdeUtc?.toISOString() ?? null,
    watermarkAnterior: baseValida ? cobertura.watermarkConfirmado!.toISOString() : null, geracao: cobertura.geracao,
    assinaturaEscopo: assinatura, contaIdentidade: entrada.contaIdentidade, fuso: incremental ? cobertura.incrementalFuso : null,
    versaoContrato: VERSAO_CONTRATO_INCREMENTAL };
}

export async function marcarAfetadosSync(tx: Tx, entrada: { grupo: string; execucao: string; entidade: EntidadeSync;
  registroIds: readonly string[]; identidadeAlterada?: boolean }): Promise<void> {
  const ids = [...new Set(entrada.registroIds)];
  if (!ids.length) return;
  if (ids.length > 500) throw new FalhaSync("LOTE_INVALIDO", "A fila de comparação exige lotes limitados.");
  await tx.$executeRaw`INSERT INTO olist_sync_afetado(configuracao_id,execucao_id,entidade,registro_id,identidade_alterada)
    SELECT ${entrada.grupo}::uuid,${entrada.execucao}::uuid,${entrada.entidade},id,${entrada.identidadeAlterada === true}
    FROM olist_sync_registro WHERE configuracao_id=${entrada.grupo}::uuid AND entidade=${entrada.entidade} AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ON CONFLICT(execucao_id,entidade,registro_id) DO UPDATE SET
      identidade_alterada=olist_sync_afetado.identidade_alterada OR EXCLUDED.identidade_alterada,processado_em=NULL`;
}

/** Move trabalho não decidido em lotes. Não carrega snapshots nem apaga pendências de negócio. */
export async function transferirAfetadosPendentes(tx: Tx, entrada: { grupo: string; execucao: string; entidades: readonly string[] }): Promise<number> {
  if (!entrada.entidades.length) return 0;
  return tx.$executeRaw`WITH candidatos AS (
    SELECT entidade,registro_id,bool_or(identidade_alterada) AS identidade_alterada FROM olist_sync_afetado
    WHERE configuracao_id=${entrada.grupo}::uuid AND execucao_id<>${entrada.execucao}::uuid
      AND (processado_em IS NULL OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa concluida WHERE concluida.execucao_id=olist_sync_afetado.execucao_id
        AND concluida.entidade=olist_sync_afetado.entidade AND concluida.fase='COMPARAR' AND concluida.status='CONCLUIDA'))
      AND entidade IN (${Prisma.join(entrada.entidades)}) GROUP BY entidade,registro_id ORDER BY entidade,registro_id LIMIT 500
  ), gravados AS (
    INSERT INTO olist_sync_afetado(configuracao_id,execucao_id,entidade,registro_id,identidade_alterada)
    SELECT ${entrada.grupo}::uuid,${entrada.execucao}::uuid,entidade,registro_id,identidade_alterada FROM candidatos
    ON CONFLICT(execucao_id,entidade,registro_id) DO UPDATE SET
      identidade_alterada=olist_sync_afetado.identidade_alterada OR EXCLUDED.identidade_alterada,processado_em=NULL
    RETURNING entidade,registro_id
  ) DELETE FROM olist_sync_afetado antigo USING gravados novo
    WHERE antigo.configuracao_id=${entrada.grupo}::uuid AND antigo.execucao_id<>${entrada.execucao}::uuid
      AND (antigo.processado_em IS NULL OR NOT EXISTS(SELECT 1 FROM olist_sync_etapa concluida WHERE concluida.execucao_id=antigo.execucao_id
        AND concluida.entidade=antigo.entidade AND concluida.fase='COMPARAR' AND concluida.status='CONCLUIDA'))
      AND antigo.entidade=novo.entidade AND antigo.registro_id=novo.registro_id`;
}

/** Configuração nova exige nova decisão, mesmo quando os snapshots não mudaram. */
export async function marcarPropostasDesatualizadas(tx: Tx, entrada: { grupo: string; execucao: string;
  entidade: EntidadeSync; versaoConfiguracao: number }): Promise<number> {
  return tx.$executeRaw`WITH candidatas AS (
    SELECT DISTINCT o.registro_id FROM olist_sync_operacao o JOIN olist_sync_registro r ON r.id=o.registro_id AND r.configuracao_id=o.configuracao_id
    WHERE o.configuracao_id=${entrada.grupo}::uuid AND r.entidade=${entrada.entidade} AND o.status IN ('AUTORIZADA','PROPOSTA')
      AND (o.precondicoes_json->'versaoConfiguracao' IS DISTINCT FROM to_jsonb(${entrada.versaoConfiguracao}::integer)
        OR o.erro_codigo='LIMITE_ALTERACOES')
    ORDER BY o.registro_id LIMIT 500
  ) INSERT INTO olist_sync_afetado(configuracao_id,execucao_id,entidade,registro_id)
    SELECT ${entrada.grupo}::uuid,${entrada.execucao}::uuid,${entrada.entidade},registro_id FROM candidatas
    ON CONFLICT(execucao_id,entidade,registro_id) DO UPDATE SET processado_em=NULL
      WHERE olist_sync_afetado.processado_em IS NOT NULL`;
}

/** Fechamento é local: chamadas remotas e a comparação já terminaram antes desta transação. */
export async function fecharCobertura(tx: Tx, entrada: { grupo: string; execucao: string; entidade: EntidadeSync; agora: Date }): Promise<boolean> {
  const execucao = await tx.olistSyncExecucao.findFirst({ where: { id: entrada.execucao, configuracaoId: entrada.grupo },
    select: { cancelamentoSolicitado: true, versaoConfiguracao: true, modo: true, configuracao: { select: {
      ativo: true, versao: true, aplicativoPaiId: true, aplicativosBloqueados: true,
      participantes: { where: { habilitado: true }, select: { aplicativoId: true, contaIdentidade: true, aplicativo: { select: { id: true, aplicativoPaiId: true } } } },
    } }, etapas: { where: { entidade: entrada.entidade, fase: { in: ["LISTAR", "DETALHAR", "COMPARAR"] } },
      select: { aplicativoId: true, fase: true, status: true, cursorJson: true }, take: 42 } } });
  if (!execucao || execucao.modo === "APLICAR" || execucao.cancelamentoSolicitado || !execucao.configuracao.ativo
    || execucao.configuracao.versao !== execucao.versaoConfiguracao) return false;
  const membros = execucao.configuracao.participantes;
  if (membros.length < 2 || membros.some(m => !m.contaIdentidade || !aplicativoElegivelSync(execucao.configuracao, m.aplicativo))) return false;
  if (await tx.olistSyncEstado.findFirst({ where: { configuracaoId: entrada.grupo, entidade: entrada.entidade,
    aplicativoId: { in: membros.map(m => m.aplicativoId) }, detalhePendente: true }, select: { id: true } })) return false;
  const etapas = execucao.etapas.filter(s => s.fase !== "COMPARAR");
  if (etapas.length !== membros.length || etapas.some(s => s.fase !== "DETALHAR" || s.status !== "CONCLUIDA")
    || !execucao.etapas.some(s => s.fase === "COMPARAR" && s.status === "CONCLUIDA")) return false;
  const pendente = await tx.$queryRaw<{ id: string }[]>`SELECT f.id FROM olist_sync_afetado f
    WHERE f.configuracao_id=${entrada.grupo}::uuid AND f.entidade=${entrada.entidade}
      AND (f.processado_em IS NULL OR (f.execucao_id<>${entrada.execucao}::uuid AND NOT EXISTS(SELECT 1 FROM olist_sync_etapa s
        WHERE s.execucao_id=f.execucao_id AND s.entidade=f.entidade AND s.fase='COMPARAR' AND s.status='CONCLUIDA'))) LIMIT 1`;
  if (pendente.length) return false;
  const assinatura = assinaturaEscopoSync(entrada.entidade, membros.map(m => m.aplicativoId));
  const planos = membros.map(m => ({ membro: m, plano: lerPlanoColeta(objetoJson(etapas.find(s => s.aplicativoId === m.aplicativoId)?.cursorJson).plano) }));
  if (planos.some(({ membro, plano }) => !plano || plano.assinaturaEscopo !== assinatura || plano.contaIdentidade !== membro.contaIdentidade || new Date(plano.iniciadaEm) > entrada.agora)) return false;
  const coberturas = await tx.olistSyncCobertura.findMany({ where: { configuracaoId: entrada.grupo, entidade: entrada.entidade,
    aplicativoId: { in: membros.map(m => m.aplicativoId) } }, select: { ...coberturaSelect, aplicativoId: true }, take: 20 });
  if (coberturas.length !== membros.length) return false;
  for (const { membro, plano } of planos) {
    if (!plano) return false;
    const cobertura = coberturas.find(v => v.aplicativoId === membro.aplicativoId);
    if (!cobertura) return false;
    if (cobertura.ultimaExecucaoId === entrada.execucao) continue;
    if (cobertura.geracao !== plano.geracao) throw new FalhaSync("COBERTURA_ALTERADA", "A cobertura mudou durante a coleta.");
    const inicio = new Date(plano.iniciadaEm);
    if (cobertura.watermarkConfirmado && inicio < cobertura.watermarkConfirmado) throw new FalhaSync("COBERTURA_ALTERADA", "A janela de coleta ficou obsoleta.");
    if (plano.modo === "INCREMENTAL" && (!cobertura.completaEm || cobertura.contaIdentidade !== plano.contaIdentidade
      || cobertura.assinaturaEscopo !== assinatura || !cobertura.incrementalValidado || cobertura.incrementalContaIdentidade !== plano.contaIdentidade
      || cobertura.incrementalFuso !== plano.fuso || cobertura.incrementalVersaoContrato !== plano.versaoContrato))
      throw new FalhaSync("INCREMENTAL_NAO_VALIDADO", "A validação incremental mudou durante a coleta.");
  }
  for (const { membro, plano } of planos) {
    const cobertura = coberturas.find(v => v.aplicativoId === membro.aplicativoId);
    if (!plano || !cobertura) throw new FalhaSync("COBERTURA_INVALIDA", "A cobertura não foi comprovada.");
    if (cobertura.ultimaExecucaoId === entrada.execucao) continue;
    const inicio = new Date(plano.iniciadaEm);
    const salva = await tx.olistSyncCobertura.updateMany({ where: { id: cobertura.id, geracao: plano.geracao }, data: {
      contaIdentidade: plano.contaIdentidade, assinaturaEscopo: assinatura, versaoContrato: VERSAO_CONTRATO_INCREMENTAL,
      watermarkConfirmado: inicio, ultimaExecucaoId: entrada.execucao, geracao: { increment: 1 },
      ...(plano.modo === "COMPLETA" ? { completaExecucaoId: entrada.execucao, completaIniciadaEm: inicio, completaEm: entrada.agora } : { incrementalEm: entrada.agora }),
    } });
    if (salva.count !== 1) throw new FalhaSync("COBERTURA_ALTERADA", "A cobertura mudou durante o fechamento.");
  }
  return true;
}
