"use client";

import React from "react";
import { ENTIDADES_SYNC_LABEL, type ConfiguracaoSyncDto, type EntidadeSyncApi, type ValidacaoIncrementalSyncInput } from "@/lib/olist-sync/api-contract";
import { dataSync, syncPanel } from "@/components/olist-sync-ui";

/** Declarações humanas ficam separadas da cobertura produzida pelo worker. */
export function ConfiguracaoIncrementalSync({ configuracao, participantesIds, entidades, validacoes, disabled, alterar }: {
  configuracao: ConfiguracaoSyncDto; participantesIds: string[]; entidades: EntidadeSyncApi[];
  validacoes: ValidacaoIncrementalSyncInput[]; disabled: boolean;
  alterar: (validacoes: ValidacaoIncrementalSyncInput[]) => void;
}) {
  const politica = configuracao.incremental;
  function atualizar(aplicativoId: string, entidade: "PRODUTO" | "CONTATO", valor?: ValidacaoIncrementalSyncInput) {
    const restantes = validacoes.filter(v => v.aplicativoId !== aplicativoId || v.entidade !== entidade);
    alterar(valor ? [...restantes, valor] : restantes);
  }
  return <section className={syncPanel}>
    <h3 className="font-semibold">Auditoria incremental por empresa</h3>
    <p className="mt-2 text-sm text-slate-600">A agenda diária usa o modo automático: incremental quando há validação da conta e uma cobertura completa válida. A cada {politica.completaCadaDias} dias, uma auditoria completa substitui a incremental. A janela repete as últimas {politica.sobreposicaoHoras} horas para reduzir perdas nas bordas.</p>
    <p className="mt-2 text-sm text-slate-600">A validação é uma declaração do responsável após ensaios na Olist, por conta, entidade e fuso. Não é inferida pelo sistema. Mudanças de conta ou contrato exigem nova validação. Formas de pagamento e vendedores continuam com leitura completa.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{configuracao.aplicativosElegiveis.filter(app => participantesIds.includes(app.id)).flatMap(app => entidades.filter((entidade): entidade is "PRODUTO" | "CONTATO" => entidade === "PRODUTO" || entidade === "CONTATO").map(entidade => {
      const cobertura = politica.coberturas.find(c => c.aplicativoId === app.id && c.entidade === entidade);
      const declaracao = validacoes.find(v => v.aplicativoId === app.id && v.entidade === entidade);
      return <section key={`${app.id}:${entidade}`} className="min-w-0 rounded-md border border-slate-200 p-4">
        <h4 className="break-words text-sm font-semibold">{app.nome} · {ENTIDADES_SYNC_LABEL[entidade]}</h4>
        <p className="mt-2 text-sm text-slate-600">{cobertura?.validado ? `Validação declarada · ${cobertura.fusoHorario}` : "Não validado para a conta atual"}</p>
        <dl className="mt-3 space-y-1 text-xs text-slate-500">
          <div><dt className="inline">Última completa: </dt><dd className="inline">{dataSync(cobertura?.completaEm ?? null)}</dd></div>
          <div><dt className="inline">Última incremental: </dt><dd className="inline">{dataSync(cobertura?.incrementalEm ?? null)}</dd></div>
          <div><dt className="inline">Cobertura confirmada até: </dt><dd className="inline">{dataSync(cobertura?.watermarkConfirmado ?? null)}</dd></div>
        </dl>
        {!cobertura?.contaIdentificada && <p className="mt-3 text-xs text-slate-500">Execute uma auditoria para identificar esta conta antes de registrar a validação.</p>}
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Registrar ou revogar validação</summary>
          <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
            <label className="block text-sm">Ação para {app.nome} · {ENTIDADES_SYNC_LABEL[entidade]}
              <select className="input mt-1 min-h-11" value={declaracao ? declaracao.validado ? "VALIDAR" : "REVOGAR" : "MANTER"} onChange={event => atualizar(app.id, entidade, event.target.value === "MANTER" ? undefined : { aplicativoId: app.id, entidade, validado: event.target.value === "VALIDAR", fusoHorario: event.target.value === "VALIDAR" ? "" : configuracao.fusoHorario, versaoContrato: politica.versaoContrato })}>
                <option value="MANTER">Manter como está</option><option value="VALIDAR" disabled={!cobertura?.contaIdentificada}>Registrar validação realizada</option><option value="REVOGAR">Revogar validação</option>
              </select>
            </label>
            {declaracao?.validado && <>
              <p className="text-xs text-slate-600">Confirme ensaios de atualização de cadastro antigo, inativação, exclusão, paginação e limites da janela. Informe o fuso observado no filtro da API e a evidência, sem documentos pessoais ou credenciais.</p>
              <label className="block text-sm">Fuso confirmado na API<input required maxLength={100} placeholder="America/Sao_Paulo" className="input mt-1 min-h-11" value={declaracao.fusoHorario} onChange={event => atualizar(app.id, entidade, { ...declaracao, fusoHorario: event.target.value })} /></label>
              <label className="block text-sm">Ensaios realizados e evidência<textarea required minLength={20} maxLength={1000} rows={4} className="input mt-1" value={declaracao.evidencia ?? ""} onChange={event => atualizar(app.id, entidade, { ...declaracao, evidencia: event.target.value })} /></label>
              <p className="text-xs text-slate-500">Ao salvar, declaro que estes ensaios foram realizados nesta conta e entidade para o contrato {politica.versaoContrato}. Isso não cria cobertura nem avança a data confirmada.</p>
            </>}
          </fieldset>
        </details>
      </section>;
    }))}</div>
  </section>;
}
