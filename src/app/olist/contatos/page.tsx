"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";

type ContatoOlist = {
  id?: number | string;
  nome?: string | null;
  codigo?: string | null;
  fantasia?: string | null;
  tipoPessoa?: "J" | "F" | "E" | "X" | null;
  cpfCnpj?: string | null;
  inscricaoEstadual?: string | null;
  rg?: string | null;
  telefone?: string | null;
  celular?: string | null;
  email?: string | null;
  endereco?: Record<string, unknown> | null;
  vendedor?: Record<string, unknown> | null;
  situacao?: "B" | "A" | "I" | "E" | null;
  statusCrm?: "L" | "P" | "C" | "I" | null;
  dataCriacao?: string | null;
  dataAtualizacao?: string | null;
};

type RespostaContatos = {
  itens: ContatoOlist[];
  paginacao: { limit: number; offset: number; total: number };
  error?: string;
};

const LIMITE = 50;
const SITUACOES: Record<string, string> = { B: "Ativo", A: "Ativo com acesso", I: "Inativo", E: "Excluído" };
const STATUS_CRM: Record<string, string> = { L: "Lead", P: "Prospect", C: "Cliente", I: "Inativo" };
const TIPOS_PESSOA: Record<string, string> = { J: "Jurídica", F: "Física", E: "Estrangeiro", X: "Estrangeiro no Brasil" };

function formatarData(valor?: string | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString("pt-BR");
}

function textoObjeto(valor?: Record<string, unknown> | null, chavesPreferidas: string[] = []) {
  if (!valor) return "—";
  const chaves = [...chavesPreferidas, ...Object.keys(valor).filter((chave) => !chavesPreferidas.includes(chave))];
  const partes = chaves
    .map((chave) => valor[chave])
    .filter((item) => item !== null && item !== undefined && typeof item !== "object" && String(item).trim())
    .map(String);
  return [...new Set(partes)].join(" · ") || "—";
}

export default function ContatosOlistPage() {
  const { session } = useAuth();
  const filtrosIniciais = { nome: "", codigo: "", cpfCnpj: "", celular: "", situacao: "", orderBy: "desc" };
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [consulta, setConsulta] = useState(filtrosIniciais);
  const [itens, setItens] = useState<ContatoOlist[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams({ limit: String(LIMITE), offset: String(offset) });
    Object.entries(consulta).forEach(([chave, valor]) => { if (valor.trim()) params.set(chave, valor.trim()); });
    try {
      const response = await fetch(`/api/olist/contatos?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const data = await response.json() as RespostaContatos;
      if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar os contatos.");
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

  return <div className="space-y-6">
    <PageHeader title="Contatos Olist" description="Consulte os contatos cadastrados na integração Olist." />
    <form onSubmit={pesquisar} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-3 xl:grid-cols-6 md:items-end">
      <label className="text-sm font-medium text-slate-700">Nome<input value={filtros.nome} onChange={(e) => setFiltros({ ...filtros, nome: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Código<input value={filtros.codigo} onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">CPF/CNPJ<input value={filtros.cpfCnpj} onChange={(e) => setFiltros({ ...filtros, cpfCnpj: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Celular<input value={filtros.celular} onChange={(e) => setFiltros({ ...filtros, celular: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-slate-700">Situação<select value={filtros.situacao} onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Todas</option><option value="B">Ativo</option><option value="A">Ativo com acesso</option><option value="I">Inativo</option><option value="E">Excluído</option></select></label>
      <div className="flex gap-2"><select aria-label="Ordenação" value={filtros.orderBy} onChange={(e) => setFiltros({ ...filtros, orderBy: e.target.value })} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"><option value="desc">Mais recentes</option><option value="asc">Mais antigos</option></select><button disabled={carregando} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Pesquisar</button></div>
    </form>
    {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Contatos</h3><span className="text-sm text-slate-500">{total.toLocaleString("pt-BR")} encontrados</span></div>
      {carregando ? <p className="p-6 text-sm text-slate-600">Consultando a Olist...</p> : itens.length === 0 ? <p className="p-6 text-sm text-slate-600">Nenhum contato encontrado.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Documento</th><th className="px-4 py-3">Telefone / e-mail</th><th className="px-4 py-3">Situação / CRM</th><th className="px-4 py-3">Vendedor</th><th className="px-4 py-3">Endereço</th><th className="px-4 py-3">Atualização</th></tr></thead><tbody className="divide-y divide-slate-100">{itens.map((contato, indice) => <tr key={`${contato.id ?? contato.codigo ?? "contato"}-${indice}`} className="align-top"><td className="min-w-56 px-4 py-3"><div className="font-medium text-slate-900">{contato.nome || contato.fantasia || "—"}</div><div className="mt-1 text-xs text-slate-500">{contato.fantasia && contato.fantasia !== contato.nome ? `${contato.fantasia} · ` : ""}Código {contato.codigo || "—"} · ID {contato.id ?? "—"}</div></td><td className="whitespace-nowrap px-4 py-3 text-slate-700"><div>{contato.cpfCnpj || "—"}</div><div className="mt-1 text-xs text-slate-500">{TIPOS_PESSOA[contato.tipoPessoa ?? ""] ?? contato.tipoPessoa ?? "—"}</div></td><td className="min-w-52 px-4 py-3 text-slate-700"><div>{contato.celular || contato.telefone || "—"}</div><div className="mt-1 text-xs text-slate-500">{contato.email || "—"}</div></td><td className="whitespace-nowrap px-4 py-3"><div>{SITUACOES[contato.situacao ?? ""] ?? contato.situacao ?? "—"}</div><div className="mt-1 text-xs text-slate-500">CRM: {STATUS_CRM[contato.statusCrm ?? ""] ?? contato.statusCrm ?? "—"}</div></td><td className="min-w-40 px-4 py-3 text-slate-600">{textoObjeto(contato.vendedor, ["nome", "id"])}</td><td className="min-w-64 px-4 py-3 text-xs text-slate-600">{textoObjeto(contato.endereco, ["endereco", "numero", "bairro", "municipio", "uf", "cep"])}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatarData(contato.dataAtualizacao ?? contato.dataCriacao)}</td></tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Página {pagina} de {totalPaginas}</span><div className="flex gap-2"><button type="button" disabled={carregando || offset === 0} onClick={() => setOffset((atual) => Math.max(0, atual - LIMITE))} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={carregando || offset + LIMITE >= total} onClick={() => setOffset((atual) => atual + LIMITE)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Próxima</button></div></div>
    </section>
  </div>;
}
