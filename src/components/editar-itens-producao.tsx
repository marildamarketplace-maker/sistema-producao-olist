"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { DetalheProducao } from "@/lib/producao-detalhes-contrato";

type Produto = { id: string; sku: string; imagem_url: string | null };
type Linha = { chave: string; id: string | null; produtoId: string; sku: string; solicitada: string; produzida: string };
type Props = { producao: DetalheProducao; token: string; onCancelar: () => void; onSalvo: () => void; onRecarregar: () => void };

export function EditarItensProducao({ producao, token, onCancelar, onSalvo, onRecarregar }: Props) {
  const [linhas, setLinhas] = useState<Linha[]>(() => producao.itens.map((item) => ({ chave: item.id, id: item.id, produtoId: item.produtoId, sku: item.sku, solicitada: String(item.quantidadeSolicitada), produzida: String(item.quantidadeProduzida) })));
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [busca, setBusca] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [carregandoProdutos, setCarregandoProdutos] = useState(true);
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const [tentativaProdutos, setTentativaProdutos] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);
  const enviando = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setCarregandoProdutos(true); setErroProdutos(null);
    void (async () => {
      try {
        const response = await fetch("/api/produtos/opcoes", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const dados = await response.json() as { produtos?: Produto[]; error?: string };
        if (!response.ok) throw new Error(dados.error ?? "Não foi possível carregar os produtos.");
        if (!controller.signal.aborted) setProdutos(dados.produtos ?? []);
      } catch (error) {
        if (!controller.signal.aborted) setErroProdutos(error instanceof Error ? error.message : "Não foi possível carregar os produtos.");
      } finally { if (!controller.signal.aborted) setCarregandoProdutos(false); }
    })();
    return () => controller.abort();
  }, [token, tentativaProdutos]);

  const selecionados = new Set(linhas.map((linha) => linha.produtoId));
  const buscaNormalizada = busca.trim().toLocaleLowerCase("pt-BR");
  const disponiveis = produtos.filter((produto) => !selecionados.has(produto.id) && produto.sku.toLocaleLowerCase("pt-BR").includes(buscaNormalizada));

  function alterar(chave: string, campo: "solicitada" | "produzida", valor: string) {
    setLinhas((atuais) => atuais.map((linha) => linha.chave === chave ? { ...linha, [campo]: valor } : linha));
  }

  async function salvar() {
    if (enviando.current) return;
    if (!linhas.length || linhas.some((linha) => [linha.solicitada, linha.produzida].some((valor) => !valor.trim() || !Number.isSafeInteger(Number(valor)) || Number(valor) < 0 || Number(valor) > 2_147_483_647))) {
      setErro("Mantenha ao menos um item e informe quantidades inteiras entre 0 e 2147483647."); return;
    }
    enviando.current = true; setSalvando(true); setErro(null); setConflito(false);
    try {
      const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(producao.id)}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revisao: producao.revisao, itens: linhas.map((linha) => ({ id: linha.id, produtoId: linha.produtoId, quantidadeSolicitada: Number(linha.solicitada), quantidadeProduzida: Number(linha.produzida) })) }),
      });
      const dados = await response.json() as { error?: string };
      if (!response.ok) { setConflito(response.status === 409); throw new Error(dados.error ?? "Não foi possível salvar os itens."); }
      onSalvo();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar os itens. Confira os dados antes de tentar novamente.");
    } finally { enviando.current = false; setSalvando(false); }
  }

  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void salvar(); }} aria-label="Editar itens da produção">
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{producao.status === "concluida" ? "Esta produção está concluída. As alterações nos itens produzidos ajustarão o estoque pela diferença, mantendo o histórico das movimentações." : "Os itens podem ser alterados neste status. Salvar não confirma a produção e não gera entrada de estoque."} O status e a foto de evidência serão mantidos.</p>
    {linhas.map((linha, index) => <article key={linha.chave} className="min-w-0 rounded-md border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3"><h4 className="min-w-0 break-all text-sm font-semibold text-slate-900">{index + 1}. {linha.sku}</h4><button type="button" disabled={salvando} onClick={() => setLinhas((atuais) => atuais.filter((item) => item.chave !== linha.chave))} aria-label={`Remover ${linha.sku}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 text-red-700 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-700">Quantidade solicitada<input required type="number" inputMode="numeric" min={0} max={2147483647} step={1} disabled={salvando} value={linha.solicitada} onChange={(event) => alterar(linha.chave, "solicitada", event.target.value)} className="input mt-1 min-h-11" /></label>
        <label className="text-sm text-slate-700">Quantidade produzida<input required type="number" inputMode="numeric" min={0} max={2147483647} step={1} disabled={salvando} value={linha.produzida} onChange={(event) => alterar(linha.chave, "produzida", event.target.value)} className="input mt-1 min-h-11" /></label>
      </div>
    </article>)}
    {!linhas.length && <p role="status" className="text-sm text-slate-600">Adicione ao menos um item para salvar.</p>}
    <fieldset disabled={salvando || carregandoProdutos || linhas.length >= 500} className="min-w-0 space-y-3 rounded-md border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">Adicionar produto</legend>
      <label className="block text-sm text-slate-700">Buscar por SKU<input type="search" value={busca} onChange={(event) => { setBusca(event.target.value); setProdutoId(""); }} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Digite parte do SKU" className="input mt-1 min-h-11" /></label>
      <label className="block text-sm text-slate-700">Produto<select value={produtoId} onChange={(event) => setProdutoId(event.target.value)} className="input mt-1 min-h-11"><option value="">Selecione um produto</option>{disponiveis.slice(0, 100).map((produto) => <option key={produto.id} value={produto.id}>{produto.sku}</option>)}</select></label>
      {disponiveis.length > 100 && <p className="text-sm text-slate-600">Refine a busca para localizar o produto desejado.</p>}
      <button type="button" disabled={!produtoId} onClick={() => {
        const produto = disponiveis.find((item) => item.id === produtoId);
        if (!produto) return;
        setLinhas((atuais) => [...atuais, { chave: `novo:${crypto.randomUUID()}`, id: null, produtoId: produto.id, sku: produto.sku, solicitada: "1", produzida: "0" }]); setProdutoId(""); setBusca("");
      }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"><Plus className="h-4 w-4" aria-hidden="true" />Adicionar item</button>
    </fieldset>
    {carregandoProdutos && <p role="status" className="text-sm text-slate-600">Carregando produtos...</p>}
    {erroProdutos && <div className="space-y-2"><p role="alert" className="text-sm text-red-700">{erroProdutos}</p><button type="button" disabled={salvando} onClick={() => setTentativaProdutos((atual) => atual + 1)} className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">Tentar carregar produtos novamente</button></div>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {conflito && <button type="button" disabled={salvando} onClick={onRecarregar} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700">Descartar edição e recarregar</button>}
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
      <button type="button" disabled={salvando} onClick={onCancelar} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancelar edição</button>
      <button type="submit" disabled={salvando || !linhas.length || conflito} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{salvando ? "Salvando..." : "Salvar alterações"}</button>
    </div>
    {salvando && <p role="status" className="text-sm text-slate-600">Salvando itens e ajustando o estoque quando aplicável...</p>}
  </form>;
}
