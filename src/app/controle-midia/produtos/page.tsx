"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";

type ProdutoMidia = {
  id: string;
  sku: string;
  ativo: boolean;
  fotoUrl: string | null;
  temFoto: boolean;
  temVideo: boolean;
  estoqueAtual: number;
  quantidadeSolicitada: number;
};

type FiltroMidia = "todos" | "com" | "sem";

export default function ControleMidiaProdutosPage() {
  const { session } = useAuth();
  const [produtos, setProdutos] = useState<ProdutoMidia[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroFoto, setFiltroFoto] = useState<FiltroMidia>("todos");
  const [filtroVideo, setFiltroVideo] = useState<FiltroMidia>("todos");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const response = await fetch("/api/controle-midia/produtos", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os produtos.");
      setProdutos(data.produtos);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro ao carregar os produtos.");
    } finally {
      setCarregando(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function atualizarMidia(produto: ProdutoMidia, campo: "temFoto" | "temVideo", valor: boolean) {
    const chave = `${produto.id}-${campo}`;
    setSalvando(chave);
    setErro(null);
    setProdutos((atuais) => atuais.map((item) => item.id === produto.id ? { ...item, [campo]: valor } : item));
    try {
      const response = await fetch("/api/controle-midia/produtos", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: produto.id, campo, valor }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar a mídia.");
    } catch (error) {
      setProdutos((atuais) => atuais.map((item) => item.id === produto.id ? { ...item, [campo]: !valor } : item));
      setErro(error instanceof Error ? error.message : "Erro ao atualizar a mídia.");
    } finally {
      setSalvando(null);
    }
  }

  const produtosFiltrados = useMemo(() => produtos.filter((produto) => {
    if (!produto.sku.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"))) return false;
    if (filtroFoto === "com" && !produto.temFoto) return false;
    if (filtroFoto === "sem" && produto.temFoto) return false;
    if (filtroVideo === "com" && !produto.temVideo) return false;
    if (filtroVideo === "sem" && produto.temVideo) return false;
    return true;
  }), [busca, filtroFoto, filtroVideo, produtos]);

  const totais = useMemo(() => ({
    fotos: produtos.filter((produto) => produto.temFoto).length,
    videos: produtos.filter((produto) => produto.temVideo).length,
  }), [produtos]);

  return <AccessGuard permissions={["podeVisualizarCategoriasMidia"]}>
    <div className="space-y-8">
      <PageHeader title="Produtos e mídias" description="Consulte quais produtos cadastrados em Produtos possuem foto e vídeo." />

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{erro}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Produtos cadastrados</h2>
            <p className="mt-1 text-sm text-slate-500">{produtos.length} produtos · {totais.fotos} com foto · {totais.videos} com vídeo</p>
          </div>
          <button type="button" onClick={() => void carregar()} disabled={carregando} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar lista
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por SKU..." className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
          <select value={filtroFoto} onChange={(event) => setFiltroFoto(event.target.value as FiltroMidia)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="todos">Todas as fotos</option><option value="com">Com foto</option><option value="sem">Sem foto</option>
          </select>
          <select value={filtroVideo} onChange={(event) => setFiltroVideo(event.target.value as FiltroMidia)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="todos">Todos os vídeos</option><option value="com">Com vídeo</option><option value="sem">Sem vídeo</option>
          </select>
        </div>

        <div className="mt-3 max-h-[65vh] overflow-auto rounded-lg border border-slate-200">
          {carregando ? <p className="p-8 text-center text-sm text-slate-500">Carregando produtos...</p> : produtosFiltrados.length ? (
            <table className="w-full min-w-[620px] border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100"><tr><th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Produto</th><th className="w-28 px-3 py-2.5 text-center text-xs font-semibold uppercase text-slate-600">Foto</th><th className="w-28 px-3 py-2.5 text-center text-xs font-semibold uppercase text-slate-600">Vídeo</th></tr></thead>
              <tbody>{produtosFiltrados.map((produto) => <tr key={produto.id} className={`border-t border-slate-100 ${produto.ativo ? "bg-white" : "bg-slate-50/70"}`}>
                <td className="px-4 py-3"><div className="flex items-center gap-3">{produto.fotoUrl ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={produto.fotoUrl} alt={produto.sku} className="h-10 w-10 rounded-md bg-slate-100 object-cover" />
                </> : <div className="h-10 w-10 rounded-md bg-slate-100" />}<div><p className="text-sm font-medium text-slate-900">{produto.sku}</p><div className="mt-1 flex flex-wrap gap-1">{produto.estoqueAtual > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Estoque: {produto.estoqueAtual}</span>}{produto.quantidadeSolicitada > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Solicitado</span>}{!produto.ativo && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Inativo</span>}</div></div></div></td>
                <td className="px-3 py-3 text-center"><input type="checkbox" checked={produto.temFoto} disabled={salvando === `${produto.id}-temFoto`} onChange={(event) => void atualizarMidia(produto, "temFoto", event.target.checked)} aria-label={`Produto ${produto.sku} tem foto`} className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-emerald-600 disabled:cursor-wait disabled:opacity-60" /></td>
                <td className="px-3 py-3 text-center"><input type="checkbox" checked={produto.temVideo} disabled={salvando === `${produto.id}-temVideo`} onChange={(event) => void atualizarMidia(produto, "temVideo", event.target.checked)} aria-label={`Produto ${produto.sku} tem vídeo`} className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-emerald-600 disabled:cursor-wait disabled:opacity-60" /></td>
              </tr>)}</tbody>
            </table>
          ) : <p className="p-8 text-center text-sm text-slate-500">Nenhum produto encontrado.</p>}
        </div>
      </section>
    </div>
  </AccessGuard>;
}
