"use client";

import { useRef, useState } from "react";

type Dados = { dataEntrega: string; prioridadeProducao: boolean };
type Props = { id: string; token: string; dados: Dados; onSalvo: (dados: Dados) => void };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

export function EditarDadosProducao({ id, token, dados, onSalvo }: Props) {
  const [edicao, setEdicao] = useState<Dados | null>(null);
  const anterior = useRef(dados);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const enviando = useRef(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  function fechar() {
    setEdicao(null);
    requestAnimationFrame(() => botaoRef.current?.focus());
  }
  async function salvar() {
    if (!edicao || enviando.current) return;
    enviando.current = true; setSalvando(true); setErro(null);
    try {
      const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...edicao, anterior: anterior.current }),
      });
      const resultado = await response.json() as { error?: string };
      if (!response.ok) throw new Error(resultado.error ?? "Não foi possível salvar os dados.");
      onSalvo(edicao); setSucesso(true); fechar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar os dados.");
    } finally { enviando.current = false; setSalvando(false); }
  }
  return <div className="space-y-3">
    <button ref={botaoRef} type="button" hidden={Boolean(edicao)} className={`${botao} text-slate-700`} onClick={() => {
      anterior.current = { ...dados }; setEdicao({ ...dados }); setErro(null); setSucesso(false);
    }}>Editar data e prioridade</button>
    {edicao && <form aria-label="Editar data e prioridade da produção" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void salvar(); }}>
      <fieldset disabled={salvando} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Data de entrega<input autoFocus required type="date" value={edicao.dataEntrega} onChange={(event) => setEdicao({ ...edicao, dataEntrega: event.target.value })} className="input mt-1 min-h-11" /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={edicao.prioridadeProducao} onChange={(event) => setEdicao({ ...edicao, prioridadeProducao: event.target.checked })} className="h-5 w-5" />Prioridade de produção</label>
      </fieldset>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={salvando} className={`${botao} bg-slate-900 text-white`}>{salvando ? "Salvando..." : "Salvar data e prioridade"}</button><button type="button" disabled={salvando} onClick={fechar} className={`${botao} text-slate-700`}>Cancelar</button></div>
    </form>}
    {sucesso && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Data e prioridade atualizadas.</p>}
  </div>;
}
