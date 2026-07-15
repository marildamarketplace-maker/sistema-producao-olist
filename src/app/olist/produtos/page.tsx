"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";

type ProdutoOlist = {
  id?: number | string;
  sku?: string;
  descricao?: string;
  tipo?: "K" | "S" | "V" | "F" | "M";
  situacao?: "A" | "I" | "E";
  dataCriacao?: string | null;
  dataAlteracao?: string | null;
  unidade?: string;
  gtin?: string;
  precos?: unknown;
  estoque?: unknown;
  tipoVariacao?: "N" | "P" | "V" | null;
};

type RespostaProdutos = {
  itens: ProdutoOlist[];
  paginacao: { limit: number; offset: number; total: number };
  error?: string;
};

const TIPOS: Record<string, string> = {
  K: "Kit", S: "Simples", V: "Com variações", F: "Fabricado", M: "Matéria-prima",
};
const SITUACOES: Record<string, string> = { A: "Ativo", I: "Inativo", E: "Excluído" };
const VARIACOES: Record<string, string> = { N: "Normal", P: "Pai", V: "Variação" };
const LIMITE = 50;

function formatarData(valor?: string | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString("pt-BR");
}

function formatarObjeto(valor: unknown) {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor !== "object") return String(valor);
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && typeof item !== "object")
    .map(([chave, item]) => `${chave}: ${String(item)}`);
  return entradas.length ? entradas.join(" · ") : "—";
}

export default function ProdutosOlistPage() {
  const { session } = useAuth();
  const [itens, setItens] = useState<ProdutoOlist[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState({ nome: "", codigo: "", gtin: "", situacao: "" });
  const [consulta, setConsulta] = useState(filtros);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
    Object.entries(consulta).forEach(([chave, valor]) => { if (valor.trim()) params.set(chave, valor.trim()); });
    try {
      const response = await fetch(`/api/olist/produtos?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const data = (await response.json()) as RespostaProdutos;
      if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar os produtos.");
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
      <PageHeader title="Produtos Olist" description="Consulte os produtos cadastrados na Olist." />

      <form onSubmit={pesquisar} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-5 md:items-end">
        <label className="text-sm font-medium text-slate-700">Nome<input value={filtros.nome} onChange={(e) => setFiltros({ ...filtros, nome: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Código/SKU<input value={filtros.codigo} onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">GTIN<input inputMode="numeric" value={filtros.gtin} onChange={(e) => setFiltros({ ...filtros, gtin: e.target.value.replace(/\D/g, "") })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Situação<select value={filtros.situacao} onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Todas</option><option value="A">Ativo</option><option value="I">Inativo</option><option value="E">Excluído</option></select></label>
        <button disabled={carregando} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Pesquisar</button>
      </form>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Produtos</h3><span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontrados</span></div>
        {carregando ? <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p> : itens.length === 0 ? <p className="p-6 text-sm text-slate-600">Nenhum produto encontrado.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">ID / SKU</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">GTIN</th><th className="px-4 py-3">Preços</th><th className="px-4 py-3">Estoque</th><th className="px-4 py-3">Alteração</th></tr></thead><tbody className="divide-y divide-slate-100">{itens.map((produto, indice) => <tr key={`${produto.id ?? produto.sku ?? "produto"}-${indice}`} className="align-top"><td className="whitespace-nowrap px-4 py-3"><div className="font-medium text-slate-900">{produto.sku || "—"}</div><div className="text-xs text-slate-500">ID {produto.id ?? "—"}</div></td><td className="min-w-64 px-4 py-3 text-slate-700"><div>{produto.descricao || "—"}</div><div className="mt-1 text-xs text-slate-500">Unidade: {produto.unidade || "—"} · {VARIACOES[produto.tipoVariacao ?? ""] ?? produto.tipoVariacao ?? "Normal"}</div></td><td className="whitespace-nowrap px-4 py-3">{TIPOS[produto.tipo ?? ""] ?? produto.tipo ?? "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${produto.situacao === "A" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{SITUACOES[produto.situacao ?? ""] ?? produto.situacao ?? "—"}</span></td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{produto.gtin || "—"}</td><td className="min-w-48 px-4 py-3 text-xs text-slate-600">{formatarObjeto(produto.precos)}</td><td className="min-w-48 px-4 py-3 text-xs text-slate-600">{formatarObjeto(produto.estoque)}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatarData(produto.dataAlteracao ?? produto.dataCriacao)}</td></tr>)}</tbody></table></div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Página {pagina} de {totalPaginas}</span><div className="flex gap-2"><button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((atual) => Math.max(0, atual - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((atual) => atual + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button></div></div>
      </section>
    </div>
  );
}
