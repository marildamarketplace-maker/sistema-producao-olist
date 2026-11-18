import { VERSAO_OBSERVACAO_CONTATO } from "@/lib/olist-sync/tipos-contato";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { criarOlistSyncRepository, ErroRepositorioSync, type ConfiguracaoSync } from "@/repositories/olist-sync-repository";
import { criarCriptografiaSync, serializarCanonico } from "@/lib/olist-sync/cripto";
import { aplicativoElegivelSync } from "@/lib/olist-sync/elegibilidade";
import { assinaturaEscopoSync, lerPlanoColeta, VERSAO_CONTRATO_INCREMENTAL } from "@/lib/olist-sync/incremental";
import { marcarAfetadosSync } from "@/repositories/olist-sync-cobertura-repository";
import { prepararPayload, gerarHashesCampos } from "@/lib/olist-sync/dominio";
import type { CamposSync } from "@/lib/olist-sync/contrato";
import { decisaoSchema, entidadeSync, objetoJson, observacaoProtegida, origemSchema } from "@/lib/olist-sync/validacao";

type DeclaracaoOrigem = z.infer<typeof origemSchema>;
type DecisaoPendencia = z.infer<typeof decisaoSchema>;

/** Metadados históricos têm versão própria do registro, sem redefinir precedência. */
export async function declararOrigemSync(db: PrismaClient, config: ConfiguracaoSync, usuarioId: string, id: string, input: DeclaracaoOrigem) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${id}::uuid AND configuracao_id=${config.id}::uuid FOR UPDATE`;
    const registro = await tx.olistSyncRegistro.findFirst({ where: { id, configuracaoId: config.id }, select: { id: true, revisao: true, origemTipo: true, aplicativoOrigemId: true, registroOlistOrigemId: true } });
    if (!registro)
      throw new ErroRepositorioSync("Registro não encontrado.", 404);
    const anterior = await tx.olistSyncEvento.findFirst({ where: { configuracaoId: config.id, registroId: id, tipo: { in: ["ORIGEM_DECLARADA", "ORIGEM_CORRIGIDA"] }, metadadosJson: { path: ["idempotencia"], equals: input.idempotencia } }, select: { metadadosJson: true } });
    if (anterior) {
      const a = objetoJson(anterior.metadadosJson);
      if (a.aplicativoOrigemId !== input.aplicativoOrigemId || a.registroOlistOrigemId !== input.registroOlistOrigemId || a.motivo !== input.motivo)
        throw new ErroRepositorioSync("Chave de idempotência já usada com outra declaração.");
      return;
    }
    if (registro.revisao !== input.revisao)
      throw new ErroRepositorioSync("O registro mudou. Atualize a comparação.");
    if (!await tx.aplicativo.findFirst({ where: { id: input.aplicativoOrigemId, aplicativoPaiId: config.aplicativoPaiId }, select: { id: true } }))
      throw new ErroRepositorioSync("A origem declarada deve pertencer ao mesmo grupo.", 400);
    await tx.olistSyncRegistro.update({ where: { id }, data: { origemTipo: "DECLARADA_POR_USUARIO", aplicativoOrigemId: input.aplicativoOrigemId, registroOlistOrigemId: input.registroOlistOrigemId, origemRegistradaEm: new Date(), origemRegistradaPor: usuarioId, origemMotivo: input.motivo, revisao: { increment: 1 } }, select: { id: true } });
    await tx.olistSyncEvento.create({ data: { configuracaoId: config.id, registroId: id, usuarioId, tipo: registro.origemTipo === "DESCONHECIDA" ? "ORIGEM_DECLARADA" : "ORIGEM_CORRIGIDA", metadadosJson: { ...input, anterior: { aplicativoOrigemId: registro.aplicativoOrigemId, registroOlistOrigemId: registro.registroOlistOrigemId } } }, select: { id: true } });
  });
}

/** Todas as decisões e o eventual aceite de reauditoria compartilham a transação. */
export async function resolverPendenciaSync(db: PrismaClient, config: ConfiguracaoSync, usuarioId: string, id: string, input: DecisaoPendencia) {
  const c = criarCriptografiaSync();
  const repo = criarOlistSyncRepository(db);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM olist_sync_configuracao WHERE id=${config.id}::uuid FOR UPDATE`;
    const atualConfig = await tx.olistSyncConfiguracao.findUniqueOrThrow({ where: { id: config.id }, select: {
      versao: true, aplicativoPaiId: true, aplicativosBloqueados: true,
      participantes: { where: { habilitado: true }, select: { aplicativoId: true, contaIdentidade: true, aplicativo: { select: { id: true, aplicativoPaiId: true } } } },
    } });
    if (atualConfig.versao !== config.versao)
      throw new ErroRepositorioSync("A configuração mudou. Recarregue antes de decidir.");
    const membros = atualConfig.participantes;
    // A fila e as propostas referenciam a execução. Travá-la antes dos estados
    // evita inverter a ordem usada pelo consumidor ao gravar observações.
    await tx.$queryRaw`SELECT e.id FROM olist_sync_execucao e WHERE e.configuracao_id=${config.id}::uuid
      AND (e.status IN ('PENDENTE','AUDITANDO','APLICANDO','AGUARDANDO_RETRY') OR e.id=(
        SELECT p.execucao_id FROM olist_sync_pendencia p WHERE p.id=${id}::uuid AND p.configuracao_id=${config.id}::uuid))
      ORDER BY e.id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM olist_sync_pendencia WHERE id=${id}::uuid AND configuracao_id=${config.id}::uuid FOR UPDATE`;
    const p = await tx.olistSyncPendencia.findFirst({ where: { id, configuracaoId: config.id }, select: { id: true, versao: true, status: true, registroId: true, entidade: true, tipo: true, execucaoId: true, chaveDedupe: true, detalhesCriptografados: true } });
    if (!p)
      throw new ErroRepositorioSync("Pendência não encontrada.", 404);
    if (p.versao !== input.versao || p.status !== "AGUARDANDO_REVISAO")
      throw new ErroRepositorioSync("A pendência mudou ou já foi resolvida. Atualize a comparação.");
    const detalhePendencia = p.detalhesCriptografados ? objetoJson(c.decifrar(p.detalhesCriptografados, `${config.id}:pendencia:${p.chaveDedupe}`)) : {};
    // Bloqueios administrativos também valem sem alterar a versão da configuração.
    // Rejeitar/ignorar continua possível para encerrar pendências de um grupo parado.
    if (["APROVAR", "VINCULAR"].includes(input.acao) && (membros.length < 2 || membros.some(m => !aplicativoElegivelSync(atualConfig, m.aplicativo))))
      throw new ErroRepositorioSync("A aprovação e o vínculo exigem ao menos dois filhos habilitados sem bloqueios no grupo.", 400);
    if (input.acao === "VINCULAR") {
      if (p.entidade === "PRODUTO" || !input.vinculos)
        throw new ErroRepositorioSync("Informe ao menos dois IDs locais da mesma entidade. Produtos são vinculados exclusivamente pelo SKU.", 400);
      if (input.vinculos.some(v => !membros.some(m => m.aplicativoId === v.aplicativoId)))
        throw new ErroRepositorioSync("Os vínculos devem pertencer aos filhos habilitados.", 400);
      const estados = await tx.olistSyncEstado.findMany({ where: { configuracaoId: config.id, entidade: p.entidade, OR: input.vinculos.map(v => ({ aplicativoId: v.aplicativoId, remoteId: v.registroOlistId })) }, select: { id: true, registroId: true, aplicativoId: true, remoteId: true, dadosCriptografados: true, metadadosJson: true, presente: true, detalhePendente: true }, take: 20 });
      const detalhe = detalhePendencia;
      if (!estados.some(e => e.aplicativoId === detalhe.aplicativoId && e.remoteId === detalhe.remoteId))
        throw new ErroRepositorioSync("O vínculo precisa incluir o cadastro desta pendência.");
      if (estados.length !== input.vinculos.length || estados.some(e => !e.dadosCriptografados || !e.presente || e.detalhePendente))
        throw new ErroRepositorioSync("Todos os IDs devem ter sido observados em uma auditoria antes do vínculo.");
      if (estados.some(e => e.registroId))
        throw new ErroRepositorioSync("Um registro já está vinculado. Revise a associação existente antes de criar outra.");
      for (const estado of estados) {
        const atual = observacaoProtegida(c.decifrar(estado.dadosCriptografados!, `${config.id}:estado:${estado.aplicativoId}:${p.entidade}:${estado.remoteId}`));
        const ativo = p.entidade === "FORMA_PAGAMENTO" ? atual.situacao === "1" : ["A", "B"].includes(atual.situacao);
        if (!atual.completo || !ativo || (p.entidade === "CONTATO" && atual.chave !== null))
          throw new ErroRepositorioSync("O vínculo manual exige cadastros ativos e completos; contatos com documento válido usam esse documento como identidade.");
      }
      const registroId = randomUUID(), chave = `manual:${registroId}`;
      await tx.olistSyncRegistro.create({ data: { id: registroId, configuracaoId: config.id, entidade: p.entidade, chave, nome: "Equivalência declarada", origemTipo: "DESCONHECIDA", origemRegistradaEm: new Date() }, select: { id: true } });
      for (const estado of estados) {
        const contexto = `${config.id}:estado:${estado.aplicativoId}:${p.entidade}:${estado.remoteId}`;
        const dados = objetoJson(c.decifrar(estado.dadosCriptografados!, contexto));
        dados.chave = chave;
        if (Array.isArray(dados.pendencias))
          dados.pendencias = dados.pendencias.filter(codigo => codigo !== "IDENTIDADE_AUSENTE_OU_INVALIDA" && codigo !== "IDENTIDADE_REQUER_REVISAO");
        await tx.olistSyncEstado.update({ where: { id: estado.id }, data: { registroId, chave, fingerprint: null, metadadosJson: { ...objetoJson(estado.metadadosJson), vinculoManual: true }, dadosCriptografados: c.cifrar(dados, contexto), status: "AGUARDANDO_REVISAO" }, select: { id: true } });
        await tx.olistSyncPendencia.updateMany({ where: { configuracaoId: config.id, chaveDedupe: c.hash(`sem-chave:${estado.aplicativoId}:${p.entidade}:${estado.remoteId}`, `${config.id}:pendencia`), id: { not: p.id }, status: "AGUARDANDO_REVISAO" }, data: { status: "RESOLVIDA", versao: { increment: 1 }, decididoEm: new Date(), decididoPor: usuarioId } });
      }
      // O vínculo precisa ser comparado mesmo se a próxima janela remota vier vazia.
      const dona = p.execucaoId ?? (await tx.olistSyncExecucao.findFirst({ where: { configuracaoId: config.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }))?.id;
      if (!dona) throw new ErroRepositorioSync("Execute uma auditoria antes de criar o vínculo.");
      await marcarAfetadosSync(tx, { grupo: config.id, execucao: dona, entidade: entidadeSync(p.entidade), registroIds: [registroId] });
    }
    if (input.acao === "APROVAR") {
      if (!p.registroId || !input.aplicativoFonteId || !["PRODUTO", "CONTATO"].includes(p.entidade) || /DUPLIC|IDENTIDADE|INCONCLUSIVO|REFERENCIA_|ESTRUTURA|VARIACAO|INATIVO|REMOVIDO/.test(p.tipo))
        throw new ErroRepositorioSync("Este conflito exige correção do cadastro e nova auditoria.");
      await tx.$queryRaw`SELECT id FROM olist_sync_registro WHERE id=${p.registroId}::uuid FOR UPDATE`;
      const registro = await tx.olistSyncRegistro.findUniqueOrThrow({ where: { id: p.registroId }, select: { revisao: true } });
      const estados = await tx.olistSyncEstado.findMany({ where: { configuracaoId: config.id, registroId: p.registroId, participante: { habilitado: true } }, select: { aplicativoId: true, remoteId: true, dadosCriptografados: true, hashesJson: true, ultimaExecucaoId: true, fingerprint: true, presente: true, detalhePendente: true, metadadosJson: true }, take: 20 });
      if(p.entidade === "CONTATO" && estados.some(s => objetoJson(s.metadadosJson).versaoObservacaoContato !== VERSAO_OBSERVACAO_CONTATO))
        throw new ErroRepositorioSync("Reaudite os contatos para validar os tipos de cada conta antes de aprovar.");
      const fonte = estados.find(s => s.aplicativoId === input.aplicativoFonteId);
      if (!fonte?.dadosCriptografados)
        throw new ErroRepositorioSync("Escolha uma empresa participante com observação completa.");
      const obs = observacaoProtegida(c.decifrar(fonte.dadosCriptografados, `${config.id}:estado:${fonte.aplicativoId}:${p.entidade}:${fonte.remoteId}`));
      if (!obs.completo || obs.pendencias.length)
        throw new ErroRepositorioSync("A origem possui dependências ou identidade pendentes.");
      const prova = objetoJson(detalhePendencia.cobertura), temProva = typeof prova.assinaturaEscopo === "string" && prova.versaoContrato === VERSAO_CONTRATO_INCREMENTAL;
      const auditoria = p.execucaoId ? await tx.olistSyncExecucao.findFirst({ where: { id: p.execucaoId, configuracaoId: config.id,
        ...(!temProva ? { completa: true, versaoConfiguracao: config.versao } : {}) }, select: { id: true, cancelamentoSolicitado: true,
        etapas: { where: { entidade: p.entidade, fase: { in: ["LISTAR", "DETALHAR", "COMPARAR"] } }, select: { aplicativoId: true, fase: true, status: true, cursorJson: true }, take: 42 } } }) : null;
      if (!auditoria || auditoria.cancelamentoSolicitado || membros.some(m => !auditoria.etapas.some(e => e.aplicativoId === m.aplicativoId && e.fase === "DETALHAR" && e.status === "CONCLUIDA")))
        throw new ErroRepositorioSync("Execute uma auditoria íntegra de todos os participantes antes de aprovar.");
      if (temProva) {
        const assinatura = assinaturaEscopoSync(entidadeSync(p.entidade), membros.map(m => m.aplicativoId));
        const coberturas = await tx.olistSyncCobertura.findMany({ where: { configuracaoId: config.id, entidade: p.entidade, aplicativoId: { in: membros.map(m => m.aplicativoId) } },
          select: { aplicativoId: true, contaIdentidade: true, assinaturaEscopo: true, versaoContrato: true, completaEm: true, watermarkConfirmado: true }, take: 20 });
        if (prova.assinaturaEscopo !== assinatura || !auditoria.etapas.some(e => e.fase === "COMPARAR" && e.status === "CONCLUIDA")
          || membros.some(m => {
            const cobertura = coberturas.find(v => v.aplicativoId === m.aplicativoId);
            const plano = lerPlanoColeta(objetoJson(auditoria.etapas.find(e => e.aplicativoId === m.aplicativoId && e.fase === "DETALHAR")?.cursorJson).plano);
            return !m.contaIdentidade || !cobertura?.completaEm || !cobertura.watermarkConfirmado || cobertura.contaIdentidade !== m.contaIdentidade
              || cobertura.assinaturaEscopo !== assinatura || cobertura.versaoContrato !== VERSAO_CONTRATO_INCREMENTAL
              || !plano || plano.assinaturaEscopo !== assinatura || plano.contaIdentidade !== m.contaIdentidade;
          })) throw new ErroRepositorioSync("A cobertura desta comparação não é mais válida. Reaudite o grupo.");
        const observacoes = objetoJson(detalhePendencia.observacoes);
        for (const membro of membros) {
          const estado = estados.find(s => s.aplicativoId === membro.aplicativoId), evidencia = observacoes[membro.aplicativoId];
          if (evidencia === null && !estado) continue;
          const snapshot = objetoJson(evidencia);
          if (!estado || !estado.presente || estado.detalhePendente || snapshot.remoteId !== estado.remoteId
            || serializarCanonico(objetoJson(snapshot.hashes)) !== serializarCanonico(objetoJson(estado.hashesJson))
            || typeof snapshot.fingerprint === "string" && snapshot.fingerprint !== estado.fingerprint)
            throw new ErroRepositorioSync("Uma réplica mudou após a comparação. Reaudite antes de aprovar.");
        }
      }
      for (const estado of estados) {
        if ((!temProva && estado.ultimaExecucaoId !== auditoria.id) || !estado.dadosCriptografados || !estado.presente || estado.detalhePendente)
          throw new ErroRepositorioSync("Há uma réplica removida ou sem observação atual. Reaudite o grupo.");
        const atual = observacaoProtegida(c.decifrar(estado.dadosCriptografados, `${config.id}:estado:${estado.aplicativoId}:${p.entidade}:${estado.remoteId}`));
        const ativo = p.entidade === "PRODUTO" ? atual.situacao === "A" : ["A", "B"].includes(atual.situacao);
        if (!atual.completo || !ativo || atual.chave !== obs.chave || atual.pendencias.length)
          throw new ErroRepositorioSync("Uma réplica possui identidade, situação ou dependências pendentes.");
        if (p.entidade === "PRODUTO" && (atual.tipo !== obs.tipo || atual.paiId !== obs.paiId && Boolean(atual.paiId) !== Boolean(obs.paiId)))
          throw new ErroRepositorioSync("Produtos com estruturas incompatíveis exigem correção no cadastro.");
      }
      const entidade = entidadeSync(p.entidade), revisao = registro.revisao + 1, replicas: CamposSync = {};
      for (const membro of membros) {
        const s = estados.find(v => v.aplicativoId === membro.aplicativoId);
        replicas[membro.aplicativoId] = s ? { remoteId: s.remoteId, hashes: objetoJson(s.hashesJson) } : null;
      }
      if (await tx.olistSyncOperacao.count({ where: { registroId: p.registroId, status: { in: ["EM_APLICACAO", "VERIFICANDO", "RESULTADO_INCONCLUSIVO"] } } }))
        throw new ErroRepositorioSync("Há uma escrita pendente de reconciliação para este registro.");
      await tx.olistSyncOperacao.updateMany({ where: { registroId: p.registroId, status: { in: ["PROPOSTA", "AUTORIZADA"] } }, data: { status: "OBSOLETA" } });
      for (const membro of membros.filter(p => p.aplicativoId !== fonte.aplicativoId)) {
        const destino = estados.find(s => s.aplicativoId === membro.aplicativoId), acao = destino ? "ATUALIZAR" : "CRIAR";
        prepararPayload(entidade, obs.campos, { operacao: acao });
        if (destino && serializarCanonico(objetoJson(destino.hashesJson)) === serializarCanonico(gerarHashesCampos(obs.campos, v => c.hash(v, `${config.id}:campo`))))
          continue;
        const operacaoId = randomUUID();
        await tx.olistSyncOperacao.create({ data: { id: operacaoId, configuracaoId: config.id, registroId: p.registroId, execucaoId: p.execucaoId, sourceAppId: fonte.aplicativoId, destinoAppId: membro.aplicativoId, acao, revisao, status: "AUTORIZADA", precondicoesJson: { replicas, ...(entidade === "CONTATO" ? { versaoObservacaoContato: VERSAO_OBSERVACAO_CONTATO } : {}), versaoConfiguracao: config.versao, fontesPorCampo: Object.fromEntries(Object.keys(obs.campos).map(k => [k, [fonte.aplicativoId]])) }, payloadCriptografado: c.cifrar(obs.campos, `${config.id}:operacao:${operacaoId}`) }, select: { id: true } });
      }
      await tx.olistSyncRegistro.update({ where: { id: p.registroId }, data: { revisao }, select: { id: true } });
    }
    await tx.olistSyncPendencia.update({ where: { id: p.id }, data: { status: ["APROVAR", "VINCULAR", "REAUDITAR"].includes(input.acao) ? "APROVADA" : input.acao === "REJEITAR" ? "REJEITADA" : "IGNORADA", versao: { increment: 1 }, motivo: input.motivo, decididoPor: usuarioId, decididoEm: new Date(), decisaoJson: { acao: input.acao, aplicativoFonteId: input.aplicativoFonteId ?? null, vinculos: input.vinculos ?? [] } }, select: { id: true } });
    await tx.olistSyncEvento.create({ data: { configuracaoId: config.id, registroId: p.registroId, usuarioId, tipo: "DECISAO_HUMANA", metadadosJson: { pendenciaId: p.id, ...input } }, select: { id: true } });
    if (input.acao === "REAUDITAR") {
      const execucao = await repo.enfileirar({ configuracaoId: config.id, modo: "AUDITAR", idempotencia: randomUUID(), solicitadoPor: usuarioId, origem: "MANUAL", completa: true }, tx);
      if (p.registroId) await marcarAfetadosSync(tx, { grupo: config.id, execucao: execucao.id, entidade: entidadeSync(p.entidade), registroIds: [p.registroId] });
      return execucao;
    }
    return null;
  }, { timeout: 25000 });
}
