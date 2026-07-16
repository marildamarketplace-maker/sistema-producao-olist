"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AccessGuard } from "@/components/access-guard";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";
import { ModalAssociarPlanosPagamento } from "@/components/modal-associar-planos-pagamento";

type FormaPagamento = { id?: number | string; nome?: string | null };
type Resposta = {
  itens: FormaPagamento[];
  paginacao: { limit: number; offset: number; total: number };
  error?: string;
};

const LIMITE = 50;

function FormasPagamentoOlistPage() {
  const { session } = useAuth();
  const [itens, setItens] = useState<FormaPagamento[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState({ nome: "", situacao: "" });
  const [consulta, setConsulta] = useState(filtros);
  const [formaSelecionada, setFormaSelecionada] = useState<{ id: string; nome: string } | null>(null);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
    if (consulta.nome.trim()) params.set("nome", consulta.nome.trim());
    if (consulta.situacao) params.set("situacao", consulta.situacao);
    try {
      const response = await fetch(`/api/olist/formas-pagamento?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json() as Resposta;
      if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar as formas de pagamento.");
      setItens(data.itens ?? []);
      setTotal(data.paginacao?.total ?? 0);
    } catch (error) {
      setItens([]);
      setTotal(0);
      setErro(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }, [consulta, offset, session?.access_token]);

  useEffect(() => { void carregar(); }, [carregar]);

  function pesquisar(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setConsulta({ ...filtros });
  }

  const pagina = Math.floor(offset / LIMITE) + 1;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE));

  return (
    <div className="space-y-6">
      <PageHeader title="Formas de pagamento Olist" description="Consulte as formas de pagamento cadastradas na Olist." />

      <form onSubmit={pesquisar} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-3 md:items-end">
        <label className="text-sm font-medium text-slate-700">Nome
          <input value={filtros.nome} onChange={(event) => setFiltros({ ...filtros, nome: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-700">Situação
          <select value={filtros.situacao} onChange={(event) => setFiltros({ ...filtros, situacao: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="">Todas</option>
            <option value="1">Habilitada</option>
            <option value="2">Desabilitada</option>
          </select>
        </label>
        <button disabled={carregando} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Pesquisar</button>
      </form>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Formas de pagamento</h3>
          <span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontradas</span>
        </div>
        {carregando ? (
          <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p>
        ) : itens.length === 0 ? (
          <p className="p-6 text-sm text-slate-600">Nenhuma forma de pagamento encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Nome</th><th className="px-4 py-3 text-right">Ações</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((item, indice) => <tr key={`${item.id ?? "forma"}-${indice}`}><td className="px-4 py-3 font-medium text-slate-700">{item.id ?? "—"}</td><td className="px-4 py-3 text-slate-900">{item.nome || "—"}</td><td className="px-4 py-3 text-right"><button type="button" disabled={item.id == null} onClick={() => setFormaSelecionada({ id: String(item.id), nome: item.nome || "Forma de pagamento" })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Associar planos</button></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <span className="text-sm text-slate-500">Página {pagina} de {totalPaginas}</span>
          <div className="flex gap-2">
            <button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((valor) => Math.max(0, valor - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button>
            <button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((valor) => valor + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button>
          </div>
        </div>
      </section>
      {formaSelecionada && session?.access_token && <ModalAssociarPlanosPagamento accessToken={session.access_token} tipo="pagamento" forma={formaSelecionada} onClose={() => setFormaSelecionada(null)} />}
    </div>
  );
}

export default function FormasPagamentoOlistAccessPage() {
  return <AccessGuard permissions={["podeVisualizarOlistFormasPagamento"]}><FormasPagamentoOlistPage /></AccessGuard>;
}
