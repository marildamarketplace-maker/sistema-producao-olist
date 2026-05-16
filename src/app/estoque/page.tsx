"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  nome: string;
  imagem_url: string | null;
  meta_estoque: number | null;
};

type Movimentacao = {
  produto_id: string;
  tipo_movimento: "entrada" | "saida";
  quantidade: number;
};

type LinhaEstoque = Produto & {
  total_entradas: number;
  total_saidas: number;
  saldo_atual: number;
  meta_aplicada: number;
};

type TipoOperacao = "entrada" | "saida" | "ajuste";

export default function EstoquePage() {
  const [linhas, setLinhas] = useState<LinhaEstoque[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [metaGeral, setMetaGeral] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [produtoId, setProdutoId] = useState("");
  const [tipoOperacao, setTipoOperacao] = useState<TipoOperacao>("entrada");
  const [quantidade, setQuantidade] = useState("1");
  const [origem, setOrigem] = useState("manual");
  const [observacao, setObservacao] = useState("");

  const produtoSelecionado = useMemo(() => produtos.find((produto) => produto.id === produtoId) ?? null, [produtoId, produtos]);

  async function carregarDados() {
    setLoading(true);
    setErrorMessage(null);

    const [{ data: produtosData, error: produtosError }, { data: movData, error: movError }, { data: cfgData, error: cfgError }] = await Promise.all([
      supabase.from("produtos").select("id, sku, nome, imagem_url, meta_estoque").eq("ativo", true).order("nome"),
      supabase.from("movimentacoes_estoque").select("produto_id, tipo_movimento, quantidade"),
      supabase.from("configuracoes_sistema").select("valor").eq("chave", "META_GERAL_ESTOQUE").maybeSingle(),
    ]);

    if (produtosError || movError || cfgError) {
      setErrorMessage(produtosError?.message ?? movError?.message ?? cfgError?.message ?? "Erro ao carregar estoque.");
      setLoading(false);
      return;
    }

    const metaGlobal = Number(cfgData?.valor ?? 0);
    setMetaGeral(Number.isNaN(metaGlobal) ? 0 : metaGlobal);

    const listaProdutos = (produtosData as Produto[]) ?? [];
    const movimentacoes = (movData as Movimentacao[]) ?? [];

    const mapa = new Map<string, { entradas: number; saidas: number }>();
    movimentacoes.forEach((mov) => {
      const atual = mapa.get(mov.produto_id) ?? { entradas: 0, saidas: 0 };
      if (mov.tipo_movimento === "entrada") atual.entradas += mov.quantidade;
      else atual.saidas += mov.quantidade;
      mapa.set(mov.produto_id, atual);
    });

    const linhasCalculadas: LinhaEstoque[] = listaProdutos.map((produto) => {
      const totais = mapa.get(produto.id) ?? { entradas: 0, saidas: 0 };
      const metaAplicada = produto.meta_estoque ?? (Number.isNaN(metaGlobal) ? 0 : metaGlobal);
      return {
        ...produto,
        total_entradas: totais.entradas,
        total_saidas: totais.saidas,
        saldo_atual: totais.entradas - totais.saidas,
        meta_aplicada: metaAplicada,
      };
    });

    setProdutos(listaProdutos);
    setLinhas(linhasCalculadas);
    setLoading(false);
  }

  useEffect(() => {
    carregarDados();
  }, []);

  async function handleAdicionarMovimentacao(event: FormEvent<HTMLFormElement>) { /* unchanged */
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    if (!produtoSelecionado) { setErrorMessage("Selecione um produto."); setSaving(false); return; }
    const quantidadeNumerica = Number(quantidade);
    if (Number.isNaN(quantidadeNumerica) || quantidadeNumerica === 0) { setErrorMessage("Informe uma quantidade válida diferente de zero."); setSaving(false); return; }
    let tipoMovimento: "entrada" | "saida";
    let quantidadeFinal: number;
    if (tipoOperacao === "ajuste") { tipoMovimento = quantidadeNumerica > 0 ? "entrada" : "saida"; quantidadeFinal = Math.abs(quantidadeNumerica); }
    else { tipoMovimento = tipoOperacao; quantidadeFinal = Math.abs(quantidadeNumerica); }
    const { error } = await supabase.from("movimentacoes_estoque").insert({ produto_id: produtoSelecionado.id, sku: produtoSelecionado.sku, tipo_movimento: tipoMovimento, quantidade: quantidadeFinal, origem, observacao: observacao.trim() || `Movimentação manual (${tipoOperacao})` });
    if (error) { setErrorMessage(`Erro ao adicionar movimentação: ${error.message}`); setSaving(false); return; }
    setQuantidade("1"); setObservacao(""); await carregarDados(); setSaving(false);
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Estoque" description="Acompanhe entradas, saídas e saldo atual dos produtos." />
      <p className="-mt-4 text-sm text-slate-600">Meta geral atual: <strong>{metaGeral}</strong> (usada quando o produto não possui meta individual).</p>
      {/* form section unchanged visually */}
      <section className="rounded-lg border border-slate-200 bg-white p-6"> <h3 className="mb-4 text-lg font-semibold text-slate-900">Adicionar movimentação manual</h3>
        <form className="grid grid-cols-1 gap-4 md:grid-cols-3" onSubmit={handleAdicionarMovimentacao}>{/* ... */}
          <label className="text-sm text-slate-700">Produto<select required value={produtoId} onChange={(event) => setProdutoId(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"><option value="">Selecione</option>{produtos.map((produto) => (<option key={produto.id} value={produto.id}>{produto.sku} - {produto.nome}</option>))}</select></label>
          <label className="text-sm text-slate-700">Tipo<select value={tipoOperacao} onChange={(event) => setTipoOperacao(event.target.value as TipoOperacao)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Ajuste (+/-)</option></select></label>
          <label className="text-sm text-slate-700">Quantidade {tipoOperacao === "ajuste" ? "(use negativo para baixar)" : ""}<input required type="number" value={quantidade} onChange={(event) => setQuantidade(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-700 md:col-span-2">Origem<input required value={origem} onChange={(event) => setOrigem(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder="manual, inventário, correção..." /></label>
          <label className="text-sm text-slate-700">Observação<input value={observacao} onChange={(event) => setObservacao(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <div className="md:col-span-3"><button type="submit" disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Salvando..." : "Adicionar movimentação"}</button></div>
        </form>{errorMessage && <p className="mt-4 text-sm text-red-600">{errorMessage}</p>}</section>
      <section className="rounded-lg border border-slate-200 bg-white p-6"><h3 className="mb-4 text-lg font-semibold text-slate-900">Posição de estoque</h3>
        {loading ? <p className="text-sm text-slate-600">Carregando estoque...</p> : linhas.length === 0 ? <p className="text-sm text-slate-600">Nenhum produto encontrado.</p> : (<div className="overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="border-b border-slate-200 text-left text-slate-600"><th className="p-3">Imagem</th><th className="p-3">SKU</th><th className="p-3">Nome</th><th className="p-3">Total de entradas</th><th className="p-3">Total de saídas</th><th className="p-3">Saldo atual</th><th className="p-3">Meta de estoque</th></tr></thead><tbody>{linhas.map((linha) => (<tr key={linha.id} className="border-b border-slate-100"><td className="p-3">{linha.imagem_url ? <img src={linha.imagem_url} alt={linha.nome} className="h-12 w-12 rounded object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">Sem imagem</div>}</td><td className="p-3 font-medium text-slate-700">{linha.sku}</td><td className="p-3 text-slate-700">{linha.nome}</td><td className="p-3 text-slate-700">{linha.total_entradas}</td><td className="p-3 text-slate-700">{linha.total_saidas}</td><td className="p-3 font-semibold text-slate-900">{linha.saldo_atual}</td><td className="p-3 text-slate-700">{linha.meta_aplicada}{linha.meta_estoque === null ? " (geral)" : ""}</td></tr>))}</tbody></table></div>)}
      </section>
    </div>
  );
}
