"use client";

import React, { useRef, useState, type FormEvent } from "react";
import { ComparacaoSync, DialogoSync, OrigemSync, StatusSync, syncButton, syncPrimary } from "@/components/olist-sync-ui";
import type {
  AcaoDecisaoSync, DeclararOrigemSyncInput, DecisaoSyncInput, EmpresaSyncDto,
  ModoExecucaoSync, PendenciaSyncDetalheDto, RegistroSyncDto,
} from "@/lib/olist-sync/api-contract";

export const ACOES_SYNC_LABEL: Record<AcaoDecisaoSync, string> = {
  APROVAR: "Aprovar proposta", REJEITAR: "Rejeitar", IGNORAR: "Ignorar divergência",
  REAUDITAR: "Solicitar nova auditoria", VINCULAR: "Vincular equivalentes",
};

export function DecisaoSyncDialog({ detalhe, empresas, podeResolver, fechar, decidir }: {
  detalhe: PendenciaSyncDetalheDto; podeResolver: boolean; fechar: () => void;
  empresas: EmpresaSyncDto[];
  decidir: (input: DecisaoSyncInput) => Promise<void>;
}) {
  const [acao, setAcao] = useState<AcaoDecisaoSync>(detalhe.acoesPermitidas[0] ?? "REAUDITAR");
  const [fonte, setFonte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vinculos, setVinculos] = useState(() => {
    const iniciais = detalhe.comparacao.map((item) => ({ aplicativoId: item.aplicativoId, registroOlistId: item.registroOlistId }));
    while (iniciais.length < 2) iniciais.push({ aplicativoId: "", registroOlistId: "" });
    return iniciais;
  });
  const vinculosValidos = vinculos.length >= 2 && new Set(vinculos.map((item) => item.aplicativoId)).size === vinculos.length
    && vinculos.every((item) => item.aplicativoId && /^\d{1,30}$/.test(item.registroOlistId));
  async function enviar(event: FormEvent) {
    event.preventDefault(); setErro(null); setOcupado(true);
    try { await decidir({ versao: detalhe.versao, acao, motivo: motivo.trim(), ...(acao === "APROVAR" && fonte ? { aplicativoFonteId: fonte } : {}), ...(acao === "VINCULAR" ? { vinculos } : {}) }); fechar(); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível registrar a decisão."); }
    finally { setOcupado(false); }
  }
  return <DialogoSync titulo="Revisar divergência" ocupado={ocupado} fechar={fechar}>
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2"><StatusSync status={detalhe.severidade} /><StatusSync status={detalhe.status} /></div>
      <p className="text-sm text-slate-700">{detalhe.resumo}</p>
      <ComparacaoSync detalhe={detalhe} />
      {podeResolver && detalhe.status === "AGUARDANDO_REVISAO" && detalhe.acoesPermitidas.length > 0 && <form onSubmit={enviar} className="space-y-4 border-t border-slate-200 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Decisão<select value={acao} onChange={(event) => setAcao(event.target.value as AcaoDecisaoSync)} className="input mt-1 min-h-11" disabled={ocupado}>
            {detalhe.acoesPermitidas.map((item) => <option key={item} value={item}>{ACOES_SYNC_LABEL[item]}</option>)}
          </select></label>
          {acao === "APROVAR" && <label className="text-sm font-medium">Aplicativo de referência<select required value={fonte} onChange={(event) => setFonte(event.target.value)} className="input mt-1 min-h-11" disabled={ocupado}>
            <option value="">Escolha a fonte dos campos</option>{detalhe.comparacao.map((item) => <option key={item.aplicativoId} value={item.aplicativoId}>{item.nome}</option>)}
          </select></label>}
        </div>
        {acao === "VINCULAR" && <fieldset className="space-y-3" disabled={ocupado}>
          <legend className="mb-2 text-sm font-medium">Registros equivalentes nas empresas</legend>
          <p className="text-xs text-slate-500">Informe IDs já observados na auditoria. O vínculo registra a equivalência e não cria nem altera cadastros na Olist.</p>
          {vinculos.map((vinculo, indice) => <div key={indice} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-medium">Empresa {indice + 1}<select required className="input mt-1 min-h-11" value={vinculo.aplicativoId} onChange={(event) => setVinculos((atual) => atual.map((item, posicao) => posicao === indice ? { ...item, aplicativoId: event.target.value } : item))}><option value="">Selecione</option>{empresas.filter((empresa) => empresa.habilitado).map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>)}</select></label>
            <label className="text-sm font-medium">ID Olist {indice + 1}<input required inputMode="numeric" pattern="[0-9]{1,30}" maxLength={30} className="input mt-1 min-h-11" value={vinculo.registroOlistId} onChange={(event) => setVinculos((atual) => atual.map((item, posicao) => posicao === indice ? { ...item, registroOlistId: event.target.value } : item))} /></label>
            <button type="button" className={syncButton} disabled={vinculos.length <= 2} onClick={() => setVinculos((atual) => atual.filter((_, posicao) => posicao !== indice))}>Remover empresa {indice + 1}</button>
          </div>)}
          <button type="button" className={syncButton} disabled={vinculos.length >= 20 || vinculos.length >= empresas.filter((empresa) => empresa.habilitado).length} onClick={() => setVinculos((atual) => [...atual, { aplicativoId: "", registroOlistId: "" }])}>Adicionar empresa ao vínculo</button>
        </fieldset>}
        <label className="block text-sm font-medium">Motivo da decisão<textarea required minLength={10} maxLength={1000} rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} className="input mt-1" disabled={ocupado} placeholder="Explique a decisão para a auditoria (mínimo de 10 caracteres)." /></label>
        <p className="text-xs text-slate-500">Aprovar autoriza uma proposta, que será revalidada antes da aplicação. A escolha da fonte não altera o aplicativo original. Alterações após esta revisão exigem uma nova decisão.</p>
        {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className={syncButton} disabled={ocupado} onClick={fechar}>Cancelar</button><button type="submit" className={syncPrimary} disabled={ocupado || motivo.trim().length < 10 || (acao === "APROVAR" && !fonte) || (acao === "VINCULAR" && !vinculosValidos)}>{ocupado ? "Registrando…" : "Registrar decisão"}</button></div>
      </form>}
    </div>
  </DialogoSync>;
}

export function OrigemSyncDialog({ registro, empresas, fechar, salvar }: {
  registro: RegistroSyncDto; empresas: EmpresaSyncDto[]; fechar: () => void;
  salvar: (input: DeclararOrigemSyncInput) => Promise<void>;
}) {
  const [appId, setAppId] = useState(registro.aplicativoOrigemId ?? "");
  const [remoteId, setRemoteId] = useState(registro.registroOlistOrigemId ?? "");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idempotencia = useRef<string | null>(null);
  async function enviar(event: FormEvent) {
    event.preventDefault(); setErro(null); setOcupado(true);
    idempotencia.current ??= crypto.randomUUID();
    try { await salvar({ revisao: registro.revisao, aplicativoOrigemId: appId, registroOlistOrigemId: remoteId.trim(), motivo: motivo.trim(), idempotencia: idempotencia.current }); fechar(); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível declarar a origem."); }
    finally { setOcupado(false); }
  }
  return <DialogoSync titulo="Declarar aplicativo original" ocupado={ocupado} fechar={fechar}>
    <form onSubmit={enviar} className="space-y-4">
      <OrigemSync registro={registro} empresas={empresas} />
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Esta ação registra uma declaração auditável de origem. Não sincroniza dados, não concede prioridade e não inclui a empresa como participante.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Aplicativo original<select required value={appId} onChange={(event) => setAppId(event.target.value)} className="input mt-1 min-h-11" disabled={ocupado}><option value="">Selecione</option>{empresas.map((app) => <option key={app.id} value={app.id}>{app.nome}{!app.habilitado ? " (fora da sincronização)" : ""}</option>)}</select></label>
        <label className="text-sm font-medium">ID do registro na Olist<input required inputMode="numeric" pattern="[0-9]{1,30}" maxLength={30} value={remoteId} onChange={(event) => setRemoteId(event.target.value)} className="input mt-1 min-h-11" disabled={ocupado} /></label>
      </div>
      <label className="block text-sm font-medium">Fundamento da declaração<textarea required minLength={10} maxLength={1000} rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} className="input mt-1" disabled={ocupado} /></label>
      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={syncButton} disabled={ocupado} onClick={fechar}>Cancelar</button><button type="submit" className={syncPrimary} disabled={ocupado || !appId || !remoteId.trim() || motivo.trim().length < 10}>{ocupado ? "Registrando…" : "Declarar origem"}</button></div>
    </form>
  </DialogoSync>;
}

export function ExecutarSyncDialog({ fechar, executar, permiteAplicar, limite }: {
  fechar: () => void; executar: (modo: ModoExecucaoSync, completa: boolean) => Promise<void>; permiteAplicar: boolean; limite: number;
}) {
  const [modo, setModo] = useState<ModoExecucaoSync>("AUDITAR");
  const [completa, setCompleta] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(event: FormEvent) {
    event.preventDefault(); setOcupado(true); setErro(null);
    try { await executar(modo, modo === "APLICAR" ? true : completa); fechar(); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível enfileirar."); }
    finally { setOcupado(false); }
  }
  return <DialogoSync titulo="Nova execução" fechar={fechar} ocupado={ocupado}>
    <form className="space-y-4" onSubmit={enviar}>
      <label className="block text-sm font-medium">Modo<select value={modo} onChange={(event) => { setModo(event.target.value as ModoExecucaoSync); setConfirmado(false); }} disabled={ocupado} className="input mt-1 min-h-11">
        <option value="AUDITAR">Somente auditar</option><option value="AUDITAR_E_APLICAR" disabled={!permiteAplicar}>Auditar e aplicar alterações seguras</option><option value="APLICAR" disabled={!permiteAplicar}>Aplicar propostas autorizadas</option>
      </select></label>
      <p className="text-sm text-slate-600">A execução ocorre em segundo plano. Você pode acompanhar seu estado na aba Execuções, inclusive após recarregar a página.</p>
      {modo !== "APLICAR" && <div className="space-y-2"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={completa} onChange={event => setCompleta(event.target.checked)} disabled={ocupado} className="h-5 w-5 shrink-0" />Forçar auditoria completa</label><p className="text-xs text-slate-500">Desmarcado: modo automático, com incremental nas contas validadas e completa quando necessária. A completa revisa todos os cadastros e pode demorar mais.</p></div>}
      {!permiteAplicar && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Aplicação indisponível: verifique as validações, a configuração ativa e a liberação do job no aplicativo pai.</p>}
      {modo !== "AUDITAR" && <label className="flex min-h-11 items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><input type="checkbox" checked={confirmado} onChange={(event) => setConfirmado(event.target.checked)} disabled={ocupado} className="mt-0.5 h-5 w-5 shrink-0" /><span>Confirmo a aplicação das propostas elegíveis na Olist, até {limite} alterações por entidade e destino. Conflitos e resultados inconclusivos continuam bloqueados.</span></label>}
      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={syncButton} onClick={fechar} disabled={ocupado}>Cancelar</button><button type="submit" className={syncPrimary} disabled={ocupado || (modo !== "AUDITAR" && (!permiteAplicar || !confirmado))}>{ocupado ? "Enfileirando…" : "Enfileirar execução"}</button></div>
    </form>
  </DialogoSync>;
}
