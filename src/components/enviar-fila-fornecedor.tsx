"use client";

import { useEffect, useRef, useState } from "react";

type Props = { solicitacaoId: string; token: string; onClose: () => void };
type Fornecedor = { id: string; nome: string };

export function EnviarFilaFornecedor({ solicitacaoId, token, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const enviandoRef = useRef(false);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [fornecedorId, setFornecedorId] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const elemento = dialog.current;
    const focoAnterior = document.activeElement;
    elemento?.showModal();
    return () => {
      elemento?.close();
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      try {
        const response = await fetch("/api/fornecedores/fila", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Erro ao carregar fornecedores.");
        setFornecedores(json.fornecedores);
      } catch (error) {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : "Erro ao carregar fornecedores.");
      } finally { if (!controller.signal.aborted) setCarregando(false); }
    }
    void carregar();
    return () => controller.abort();
  }, [token]);

  async function enviar(event: React.FormEvent) {
    event.preventDefault();
    if (!fornecedorId || enviandoRef.current || sucesso) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErro("");
    try {
      const response = await fetch("/api/fornecedores/fila", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fornecedorId, solicitacaoId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Erro ao enviar para a fila.");
      setSucesso(true);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro ao enviar para a fila."); }
    finally { enviandoRef.current = false; setEnviando(false); }
  }

  return (
    <dialog ref={dialog} aria-labelledby="fila-fornecedor-titulo" onCancel={(event) => { if (enviando) event.preventDefault(); else onClose(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 text-slate-900 backdrop:bg-black/50 sm:p-6">
      <form onSubmit={enviar} className="space-y-4" aria-busy={enviando}>
        <h2 id="fila-fornecedor-titulo" className="text-lg font-semibold">Enviar para fila do Fornecedor</h2>
        <p className="text-sm text-slate-600">Registra os itens atuais da solicitação na fila do fornecedor, com tecido, quantidades, estampa, variante e corte a laser.</p>
        {erro && <p role="alert" className="break-words text-sm text-red-700">{erro}</p>}
        {sucesso ? <p role="status" className="text-sm text-emerald-700">Solicitação registrada na fila do fornecedor.</p> : (
          <>
            <label htmlFor="fila-fornecedor" className="block text-sm font-medium">Selecione o fornecedor</label>
            <select autoFocus id="fila-fornecedor" required className="input min-h-11 w-full" value={fornecedorId} onChange={(event) => setFornecedorId(event.target.value)} disabled={carregando || enviando}>
              <option value="">{carregando ? "Carregando..." : "Selecione"}</option>
              {fornecedores.map((fornecedor) => <option key={fornecedor.id} value={fornecedor.id}>{fornecedor.nome}</option>)}
            </select>
            {!carregando && !fornecedores.length && <p role="status" className="text-sm text-slate-600">Nenhum fornecedor com usuário ativo e aplicativo vinculado disponível.</p>}
          </>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} disabled={enviando} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{sucesso ? "Fechar" : "Cancelar"}</button>
          {!sucesso && <button type="submit" disabled={!fornecedorId || carregando || enviando} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{enviando ? "Enviando..." : "Enviar para fila"}</button>}
        </div>
      </form>
    </dialog>
  );
}
