"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  nome: string;
  imagem_url: string | null;
};

type Solicitacao = {
  id: string;
  data_entrega: string;
  status: string;
  created_at: string;
};

type ItemSolicitacao = {
  id: string;
  solicitacao_id: string;
};

type ItemForm = {
  produto_id: string;
  quantidade_solicitada: string;
  corte_laser: boolean;
  observacao: string;
};

const ITEM_INICIAL: ItemForm = {
  produto_id: "",
  quantidade_solicitada: "1",
  corte_laser: false,
  observacao: "",
};

export default function SolicitacoesProducaoPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [itens, setItens] = useState<ItemSolicitacao[]>([]);
  const [dataEntrega, setDataEntrega] = useState("");
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [itensForm, setItensForm] = useState<ItemForm[]>([{ ...ITEM_INICIAL }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [dataLimiteOlist, setDataLimiteOlist] = useState("");
  const [integrandoOlist, setIntegrandoOlist] = useState(false);

  const qtdItensPorSolicitacao = useMemo(() => {
    return itens.reduce<Record<string, number>>((acc, item) => {
      acc[item.solicitacao_id] = (acc[item.solicitacao_id] ?? 0) + 1;
      return acc;
    }, {});
  }, [itens]);

  async function carregarDados() {
    setLoading(true);
    setErrorMessage(null);

    const [produtosResp, solicitacoesResp, itensResp] = await Promise.all([
      supabase.from("produtos").select("id, sku, nome, imagem_url").eq("ativo", true).order("nome"),
      supabase.from("solicitacoes_producao").select("id, data_entrega, status, created_at").order("created_at", { ascending: false }),
      supabase.from("itens_solicitacao_producao").select("id, solicitacao_id"),
    ]);

    if (produtosResp.error || solicitacoesResp.error || itensResp.error) {
      setErrorMessage(produtosResp.error?.message ?? solicitacoesResp.error?.message ?? itensResp.error?.message ?? "Erro ao carregar dados.");
      setLoading(false);
      return;
    }

    setProdutos((produtosResp.data as Produto[]) ?? []);
    setSolicitacoes((solicitacoesResp.data as Solicitacao[]) ?? []);
    setItens((itensResp.data as ItemSolicitacao[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    carregarDados();
  }, []);

  function alterarItem(index: number, patch: Partial<ItemForm>) {
    setItensForm((anterior) => anterior.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function adicionarItem() {
    setItensForm((anterior) => [...anterior, { ...ITEM_INICIAL }]);
  }

  function removerItem(index: number) {
    setItensForm((anterior) => (anterior.length > 1 ? anterior.filter((_, i) => i !== index) : anterior));
  }


  async function gerarViaOlist() {
    if (!dataLimiteOlist) {
      setErrorMessage("Informe a data limite para integração Olist.");
      return;
    }
    setIntegrandoOlist(true);
    setErrorMessage(null);
    const resp = await fetch("/api/olist/gerar-solicitacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data_limite: dataLimiteOlist }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      setErrorMessage(`Erro integração Olist: ${json.error ?? "desconhecido"}`);
      setIntegrandoOlist(false);
      return;
    }
    await carregarDados();
    setIntegrandoOlist(false);
  }

  async function handleSalvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);

    if (!dataEntrega) {
      setErrorMessage("Selecione a data de entrega.");
      setSaving(false);
      return;
    }

    const itensNormalizados = itensForm.map((item) => ({
      ...item,
      quantidade: Number(item.quantidade_solicitada),
    }));

    const itemInvalido = itensNormalizados.find((item) => !item.produto_id || Number.isNaN(item.quantidade) || item.quantidade <= 0);

    if (itemInvalido) {
      setErrorMessage("Preencha produto e quantidade válida para todos os itens.");
      setSaving(false);
      return;
    }

    const { data: solicitacaoCriada, error: solicitacaoErro } = await supabase
      .from("solicitacoes_producao")
      .insert({
        data_entrega: dataEntrega,
        status: "em_producao",
        observacao_geral: observacaoGeral.trim() || null,
      })
      .select("id")
      .single();

    if (solicitacaoErro || !solicitacaoCriada) {
      setErrorMessage(`Erro ao criar solicitação: ${solicitacaoErro?.message ?? "erro desconhecido"}`);
      setSaving(false);
      return;
    }

    const itensPayload = itensNormalizados.map((item) => {
      const produto = produtos.find((p) => p.id === item.produto_id);
      return {
        solicitacao_id: solicitacaoCriada.id,
        produto_id: item.produto_id,
        sku: produto?.sku ?? "",
        nome: produto?.nome ?? "",
        imagem_url: produto?.imagem_url ?? null,
        quantidade_solicitada: item.quantidade,
        quantidade_produzida: 0,
        tipo_corte: item.corte_laser ? "LASER" : "PADRAO",
        observacao: item.observacao.trim() || null,
        status_item: "em_producao",
      };
    });

    const { error: itensErro } = await supabase.from("itens_solicitacao_producao").insert(itensPayload);

    if (itensErro) {
      setErrorMessage(`Solicitação criada, mas erro ao criar itens: ${itensErro.message}`);
      setSaving(false);
      return;
    }

    setDataEntrega("");
    setObservacaoGeral("");
    setItensForm([{ ...ITEM_INICIAL }]);
    await carregarDados();
    setSaving(false);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Solicitações de Produção"
        description="Crie novas solicitações e acompanhe as solicitações já abertas."
      />


      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Gerar solicitação via Olist</h3>
        <div className="flex flex-col gap-3 md:max-w-md">
          <label className="text-sm text-slate-700">
            Data limite de entrega
            <input type="date" value={dataLimiteOlist} onChange={(e) => setDataLimiteOlist(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <button type="button" onClick={gerarViaOlist} disabled={integrandoOlist} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {integrandoOlist ? "Integrando..." : "Gerar solicitação automaticamente"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Nova solicitação manual</h3>

        <form className="space-y-4" onSubmit={handleSalvar}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Data de entrega
              <input
                required
                type="date"
                value={dataEntrega}
                onChange={(event) => setDataEntrega(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Observação geral
              <input
                value={observacaoGeral}
                onChange={(event) => setObservacaoGeral(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-3">
            {itensForm.map((item, index) => (
              <div key={index} className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-5">
                <label className="text-sm text-slate-700 md:col-span-2">
                  Produto
                  <select
                    required
                    value={item.produto_id}
                    onChange={(event) => alterarItem(index, { produto_id: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="">Selecione</option>
                    {produtos.map((produto) => (
                      <option key={produto.id} value={produto.id}>
                        {produto.sku} - {produto.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm text-slate-700">
                  Quantidade
                  <input
                    required
                    type="number"
                    min={1}
                    value={item.quantidade_solicitada}
                    onChange={(event) => alterarItem(index, { quantidade_solicitada: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={item.corte_laser}
                    onChange={(event) => alterarItem(index, { corte_laser: event.target.checked })}
                  />
                  Corte a laser
                </label>

                <label className="text-sm text-slate-700">
                  Observação
                  <input
                    value={item.observacao}
                    onChange={(event) => alterarItem(index, { observacao: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>

                <div className="md:col-span-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removerItem(index)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                  >
                    Remover item
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={adicionarItem}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              + Adicionar item
            </button>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar solicitação"}
          </button>
        </form>

        {errorMessage && <p className="mt-4 text-sm text-red-600">{errorMessage}</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Solicitações cadastradas</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando solicitações...</p>
        ) : solicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma solicitação criada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Data de entrega</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Quantidade de itens</th>
                  <th className="p-3">Data de criação</th>
                </tr>
              </thead>
              <tbody>
                {solicitacoes.map((solicitacao) => (
                  <tr key={solicitacao.id} className="border-b border-slate-100">
                    <td className="p-3 text-slate-700">{new Date(`${solicitacao.data_entrega}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                    <td className="p-3 font-medium text-slate-700">{solicitacao.status === "em_producao" ? "EM_PRODUCAO" : solicitacao.status.toUpperCase()}</td>
                    <td className="p-3 text-slate-700">{qtdItensPorSolicitacao[solicitacao.id] ?? 0}</td>
                    <td className="p-3 text-slate-700">{new Date(solicitacao.created_at).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
