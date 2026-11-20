"use client";
import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { requisicaoIa } from "@/hooks/use-trabalhos-ia";
import { botaoIa, DialogoIa, primarioIa } from "./dialogo";

type Config = { prompt: string; revisao: number; gerarAutomaticamente: boolean; geracao: string; revisaoFixa: string };
const endpoint = "/api/olist/anotar-sku/configuracao-ia";
function Formulario({ token, fechar }: { token: string; fechar: () => void }) {
  const [config, setConfig] = useState<Config | null>(null), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [salvo, setSalvo] = useState(false);
  const bloqueio = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    requisicaoIa<Config>(token, endpoint, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) }).then(setConfig).catch(e => { if (!controller.signal.aborted) setErro(e.message); });
    return () => controller.abort();
  }, [token]);
  async function salvar() {
    if (!config || bloqueio.current) return;
    bloqueio.current = true; setSalvando(true); setErro(""); setSalvo(false);
    try { const nova = await requisicaoIa<Pick<Config, "prompt" | "revisao" | "gerarAutomaticamente">>(token, endpoint, { method: "PUT", body: JSON.stringify({ prompt: config.prompt, revisao: config.revisao, gerarAutomaticamente: config.gerarAutomaticamente }) }); setConfig({ ...config, ...nova }); setSalvo(true); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { bloqueio.current = false; setSalvando(false); }
  }
  return <DialogoIa titulo="Configuração do relatório IA" fechar={fechar}>
    <p className="text-sm text-slate-600">Defina os tecidos, equivalências e orientações para este aplicativo. As alterações valem para novos relatórios. A conferência dos SKUs e a revisão continuam obrigatórias.</p>
    {config ? <div className="mt-4 space-y-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-slate-700" checked={config.gerarAutomaticamente ?? false} disabled={salvando} aria-describedby="sku-ia-automatico-ajuda" onChange={e => { setConfig({ ...config, gerarAutomaticamente: e.target.checked }); setSalvo(false); }} />
        <span className="min-w-0"><span className="block text-sm font-medium text-slate-900">Gerar relatório IA automaticamente</span><span id="sku-ia-automatico-ajuda" className="mt-1 block text-sm text-slate-600">Ao concluir uma nova busca com SKUs, solicitar o relatório mesmo com a tela fechada. Não altera buscas anteriores.</span></span>
      </label>
      <label className="block text-sm font-medium text-slate-900">Instruções personalizadas<textarea className="input mt-2 min-h-48 w-full" maxLength={8000} value={config.prompt} disabled={salvando} onChange={e => { setConfig({ ...config, prompt: e.target.value }); setSalvo(false); }} /></label>
      <p className="text-xs text-slate-500">{config.prompt.length}/8.000 caracteres · Versão {config.revisao}</p>
      <details className="rounded-md border border-slate-200 p-3 text-sm text-slate-700"><summary className="min-h-11 cursor-pointer py-3 font-medium">Instruções fixas de geração e revisão</summary><p className="mt-3 whitespace-pre-wrap break-words">{config.geracao}</p><p className="mt-4 whitespace-pre-wrap break-words">{config.revisaoFixa}</p></details>
      <button type="button" className={primarioIa} disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar configuração"}</button>
    </div> : !erro && <p role="status" className="mt-4 text-sm text-slate-600">Carregando configuração…</p>}
    {erro && <p role="alert" className="mt-4 text-sm text-red-700">{erro}</p>}{salvo && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">Configuração salva para os próximos relatórios.</p>}
  </DialogoIa>;
}
export function ConfiguracaoSkuIa({ token }: { token: string }) {
  const [aberto, setAberto] = useState(false);
  return <><button type="button" className={`${botaoIa} min-w-11`} aria-label="Configurar relatório IA" title="Configurar relatório IA" onClick={() => setAberto(true)}><Settings className="h-5 w-5" aria-hidden="true" /></button>{aberto && <Formulario token={token} fechar={() => setAberto(false)} />}</>;
}
