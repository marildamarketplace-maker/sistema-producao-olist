"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Search } from "lucide-react";
import type { OpcaoFilaOlist } from "@/lib/fila-olist-contrato";
import { pesquisarTecidoOlist } from "@/lib/pesquisar-tecido-olist";

export function PesquisaTecidoOlist({ nome, api, token, disabled, children, produtoId, preco, aoEncontrar, aoAlterarPreco }: {
  nome: string; api: string | null; token: string; disabled: boolean; children: ReactNode; produtoId: number; preco: number | null;
  aoEncontrar: (produto: OpcaoFilaOlist) => void; aoAlterarPreco: (preco: number | null) => void;
}) {
  const id = useId();
  const controller = useRef<AbortController | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [encontrado, setEncontrado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  useEffect(() => {
    controller.current?.abort();
    setEncontrado(false); setMensagem(""); setCarregando(false); setErro(false);
    return () => controller.current?.abort();
  }, [nome, api, token]);

  async function pesquisar() {
    if (!api || controller.current && !controller.current.signal.aborted && carregando) return;
    const atual = new AbortController(); controller.current = atual;
    setCarregando(true); setEncontrado(false); setMensagem(""); setErro(false);
    try {
      const achou = await pesquisarTecidoOlist<OpcaoFilaOlist>(nome, async (pagina) => {
        const response = await fetch(`${api}&${new URLSearchParams({ recurso: "produtos", busca: nome.trim(), pagina: String(pagina) })}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: atual.signal, cache: "no-store",
        });
        const dados = await response.json();
        if (!response.ok) throw new Error(dados.error || "Não foi possível consultar a Olist.");
        return dados;
      });
      if (!atual.signal.aborted) {
        setEncontrado(Boolean(achou));
        if (achou) aoEncontrar(achou);
        setMensagem(achou ? "Tecido encontrado na Olist da filial." : "Nenhum tecido com esse nome exato encontrado na Olist da filial.");
      }
    } catch (error) {
      if (!atual.signal.aborted) { setErro(true); setMensagem(error instanceof Error ? error.message : "Falha na pesquisa."); }
    } finally { if (!atual.signal.aborted) setCarregando(false); }
  }

  return <div className="min-w-0 space-y-2">
    <div className="flex items-end gap-2" aria-describedby={id} aria-busy={carregando}>
      <div className={`min-w-0 flex-1 ${encontrado ? "tecido-olist-encontrado" : ""}`}>{children}</div>
      <button type="button" disabled={disabled || carregando || !api || !nome.trim()} onClick={() => void pesquisar()}
        aria-label="Procurar nome do tecido na Olist" title="Procurar nome do tecido na Olist"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
        <Search aria-hidden="true" size={20} />
      </button>
    </div>
    {produtoId > 0 && <label className="block text-sm">Preço do tecido por metro (R$)
      <input type="number" min="0" max="1000000000" step="0.01" disabled={disabled || carregando}
        value={preco ?? ""} onChange={(event) => aoAlterarPreco(event.target.value === "" ? null : Number(event.target.value))}
        className="input mt-1 min-h-11" />
      <span className="mt-1 block text-xs text-slate-600">Preço aplicado apenas a este pedido.</span>
    </label>}
    <p id={id} role={erro ? "alert" : "status"} className={`flex items-start gap-1 text-xs ${encontrado ? "text-emerald-700 dark:text-emerald-300" : erro ? "text-red-700" : "text-slate-600"}`}>
      {encontrado && <CheckCircle2 aria-hidden="true" size={16} className="shrink-0" />}
      {carregando ? "Consultando Olist..." : mensagem || (!api ? "Selecione uma filial para pesquisar na Olist." : "")}
    </p>
  </div>;
}
