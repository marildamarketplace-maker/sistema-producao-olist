"use client";

import { useRef, useState } from "react";

type Props = { id: string; token: string; observacao: string | null; onSalvo: (valor: string | null) => void };
const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50";

export function EditarObservacaoProducao({ id, token, observacao, onSalvo }: Props) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [anterior, setAnterior] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const enviando = useRef(false);
  const editarRef = useRef<HTMLButtonElement>(null);

  function fechar() {
    setEditando(false);
    requestAnimationFrame(() => editarRef.current?.focus());
  }

  async function salvar() {
    if (enviando.current) return;
    enviando.current = true; setSalvando(true); setErro(null);
    try {
      const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ observacaoGeral: texto, observacaoAnterior: anterior }),
      });
      const dados = await response.json() as { error?: string; observacaoGeral: string | null };
      if (!response.ok) throw new Error(dados.error ?? "Não foi possível salvar a observação.");
      onSalvo(dados.observacaoGeral); setSucesso(true); fechar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar a observação.");
    } finally { enviando.current = false; setSalvando(false); }
  }

  return <div className="space-y-3 whitespace-normal">
    <button ref={editarRef} type="button" hidden={editando} className={`${botao} text-slate-700`} onClick={() => {
      setTexto(observacao ?? ""); setAnterior(observacao); setErro(null); setSucesso(false); setEditando(true);
    }}>Editar observação</button>
    {editando ? <form className="space-y-3" aria-label="Editar observação da produção" onSubmit={(event) => { event.preventDefault(); void salvar(); }}>
      <label className="block text-sm text-slate-700">Observação geral<textarea autoFocus maxLength={5000} disabled={salvando} value={texto} onChange={(event) => setTexto(event.target.value)} className="input mt-1 min-h-32" /></label>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={salvando} className={`${botao} bg-slate-900 text-white`}>{salvando ? "Salvando..." : "Salvar observação"}</button>
        <button type="button" disabled={salvando} className={`${botao} text-slate-700`} onClick={fechar}>Cancelar</button>
      </div>
      {salvando && <p role="status" className="text-sm text-slate-600">Salvando observação...</p>}
    </form> : <p className="whitespace-pre-wrap break-words">{observacao || "Nenhuma observação informada."}</p>}
    {sucesso && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Observação atualizada com sucesso.</p>}
  </div>;
}
