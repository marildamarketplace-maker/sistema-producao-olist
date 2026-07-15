"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";

type Contato = {
  id?: number;
  nome?: string | null;
  codigo?: string | null;
  fantasia?: string | null;
  tipoPessoa?: "J" | "F" | "E" | "X" | null;
  cpfCnpj?: string | null;
  telefone?: string | null;
  celular?: string | null;
  email?: string | null;
  endereco?: Record<string, unknown> | null;
};
type Vendedor = { id?: number; contato?: Contato | null; situacao?: "B" | "A" | "I" | "E" | null };
type Resposta = { itens: Vendedor[]; paginacao: { total: number }; error?: string };
const LIMITE = 50;
const SITUACOES: Record<string, string> = { B: "Ativo", A: "Ativo com acesso", I: "Inativo", E: "Excluído" };
const TIPOS_PESSOA: Record<string, string> = { J: "Jurídica", F: "Física", E: "Estrangeiro", X: "Estrangeiro no Brasil" };

function enderecoTexto(endereco?: Record<string, unknown> | null) {
  if (!endereco) return "—";
  const chaves = ["endereco", "numero", "complemento", "bairro", "municipio", "cidade", "uf", "cep"];
  const valores = chaves.map((chave) => endereco[chave]).filter((valor) => valor !== null && valor !== undefined && String(valor).trim()).map(String);
  return [...new Set(valores)].join(" · ") || "—";
}

function VendedoresOlistPage() {
  const { session } = useAuth();
  const [filtros, setFiltros] = useState({ nome: "", codigo: "" });
  const [consulta, setConsulta] = useState(filtros);
  const [itens, setItens] = useState<Vendedor[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!session?.access_token) return;
    setCarregando(true); setErro(null);
    const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
    if (consulta.nome.trim()) params.set("nome", consulta.nome.trim());
    if (consulta.codigo.trim()) params.set("codigo", consulta.codigo.trim());
    try {
      const response = await fetch(`/api/olist/vendedores?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json() as Resposta;
      if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar os vendedores.");
      setItens(data.itens ?? []); setTotal(data.paginacao?.total ?? 0);
    } catch (error) {
      setItens([]); setTotal(0); setErro(error instanceof Error ? error.message : "Erro inesperado.");
    } finally { setCarregando(false); }
  }, [consulta, offset, session?.access_token]);

  useEffect(() => { void carregar(); }, [carregar]);
  function pesquisar(event: FormEvent) { event.preventDefault(); setOffset(0); setConsulta({ ...filtros }); }
  const pagina = Math.floor(offset / LIMITE) + 1;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));

  return <div className="space-y-6">
    <PageHeader title="Vendedores Olist" description="Consulte os vendedores cadastrados na integração Olist." />
    <form onSubmit={pesquisar} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label className="text-sm font-medium text-slate-700">Nome<input value={filtros.nome} onChange={(e) => setFiltros({ ...filtros, nome: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Código<input value={filtros.codigo} onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <button disabled={carregando} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">Pesquisar</button>
    </form>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Vendedores</h3><span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontrados</span></div>
      {carregando ? <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p> : itens.length === 0 ? <p className="p-6 text-sm text-slate-600">Nenhum vendedor encontrado.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Vendedor</th><th className="px-4 py-3">Documento</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Endereço</th></tr></thead><tbody className="divide-y divide-slate-100">{itens.map((vendedor, indice) => { const contato = vendedor.contato ?? {}; return <tr key={`${vendedor.id ?? contato.id ?? "vendedor"}-${indice}`} className="align-top"><td className="min-w-56 px-4 py-3"><div className="font-medium text-slate-900">{contato.nome || contato.fantasia || "—"}</div><div className="mt-1 text-xs text-slate-500">Código {contato.codigo || "—"} · ID {vendedor.id ?? "—"}</div></td><td className="whitespace-nowrap px-4 py-3"><div>{contato.cpfCnpj || "—"}</div><div className="mt-1 text-xs text-slate-500">{TIPOS_PESSOA[contato.tipoPessoa ?? ""] ?? contato.tipoPessoa ?? "—"}</div></td><td className="min-w-52 px-4 py-3"><div>{contato.celular || contato.telefone || "—"}</div><div className="mt-1 text-xs text-slate-500">{contato.email || "—"}</div></td><td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${vendedor.situacao === "B" || vendedor.situacao === "A" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{SITUACOES[vendedor.situacao ?? ""] ?? vendedor.situacao ?? "—"}</span></td><td className="min-w-64 px-4 py-3 text-xs text-slate-600">{enderecoTexto(contato.endereco)}</td></tr>; })}</tbody></table></div>}
      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Página {pagina} de {paginas}</span><div className="flex gap-2"><button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((atual) => Math.max(0, atual - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((atual) => atual + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button></div></div>
    </section>
  </div>;
}

export default function VendedoresOlistAccessPage() {
  return <AccessGuard permissions={["podeVisualizarOlistVendedores"]}><VendedoresOlistPage /></AccessGuard>;
}
