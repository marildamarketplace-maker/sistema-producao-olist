"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ChevronDown } from "lucide-react";
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
  periodo_inicio: string | null;
  periodo_fim: string | null;
};

type ItemSolicitacao = {
  id: string;
  solicitacao_id: string;
  sku: string;
  nome: string;
  quantidade_solicitada: number;
};

type ItemForm = {
  produto_id: string;
  quantidade_solicitada: string;
  corte_laser: boolean;
  observacao: string;
};

type ResultadoImportacaoOlist = {
  pedidos_encontrados: number;
  pedidos_adicionados: number;
  pedidos_ignorados: number;
  motivo_pedidos_ignorados: string;
};

const FILTRO_DATA_BASE_OLIST = "APROVACAO_PEDIDO";
const TIME_ZONE = "America/Sao_Paulo";
const SITUACOES_OLIST = [
  { valor: "3", label: "Aprovada" },
  { valor: "4", label: "Preparando Envio" },
  { valor: "1", label: "Faturada" },
  { valor: "7", label: "Pronto Envio" },
];
const SITUACOES_OLIST_PADRAO = ["3", "4", "1"];

function formatarDataLocal(date: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));

  return `${valores.year}-${valores.month}-${valores.day}`;
}

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
  const [solicitacoesAbertas, setSolicitacoesAbertas] = useState<Record<string, boolean>>({});

  const [agoraOlist, setAgoraOlist] = useState(() => new Date());
  const [situacoesOlistSelecionadas, setSituacoesOlistSelecionadas] = useState<string[]>(SITUACOES_OLIST_PADRAO);
  const [integrandoOlist, setIntegrandoOlist] = useState(false);
  const [resumoImportacaoOlist, setResumoImportacaoOlist] = useState<ResultadoImportacaoOlist | null>(null);

  const ultimaSolicitacaoCriada = solicitacoes[0] ?? null;

  const periodoCalculado = useMemo(() => {
    if (!ultimaSolicitacaoCriada) return {
        periodo_inicio: new Date("2026-01-01"),
        periodo_fim: new Date(),
      };

    const periodoInicio = new Date(ultimaSolicitacaoCriada.periodo_fim ?? ultimaSolicitacaoCriada.created_at);

    if (Number.isNaN(periodoInicio.getTime())) return null;

    return {
      periodo_inicio: periodoInicio,
      periodo_fim: agoraOlist,
    };
  }, [agoraOlist, ultimaSolicitacaoCriada]);

  const qtdItensPorSolicitacao = useMemo(() => {
    return itens.reduce<Record<string, number>>((acc, item) => {
      acc[item.solicitacao_id] = (acc[item.solicitacao_id] ?? 0) + 1;
      return acc;
    }, {});
  }, [itens]);

  const itensPorSolicitacao = useMemo(() => {
    return itens.reduce<Record<string, ItemSolicitacao[]>>((acc, item) => {
      acc[item.solicitacao_id] = [...(acc[item.solicitacao_id] ?? []), item];
      return acc;
    }, {});
  }, [itens]);

  async function carregarDados() {
    setLoading(true);
    setErrorMessage(null);

    const [produtosResp, solicitacoesResp, itensResp] = await Promise.all([
      supabase.from("produtos").select("id, sku, nome, imagem_url").eq("ativo", true).order("nome"),
      supabase.from("solicitacoes_producao").select("id, data_entrega, status, created_at, periodo_inicio, periodo_fim").order("created_at", { ascending: false }),
      supabase.from("itens_solicitacao_producao").select("id, solicitacao_id, sku, nome, quantidade_solicitada").order("nome"),
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

  useEffect(() => {
    const intervalId = window.setInterval(() => setAgoraOlist(new Date()), 30000);

    return () => window.clearInterval(intervalId);
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

  function alternarDetalhesSolicitacao(solicitacaoId: string) {
    setSolicitacoesAbertas((anterior) => ({
      ...anterior,
      [solicitacaoId]: !anterior[solicitacaoId],
    }));
  }

  function alternarSituacaoOlist(situacao: string) {
    setSituacoesOlistSelecionadas((anteriores) =>
      anteriores.includes(situacao)
        ? anteriores.filter((item) => item !== situacao)
        : [...anteriores, situacao],
    );
  }


  async function gerarViaOlist() {
    const periodoAtual = periodoCalculado
      ? {
          periodo_inicio: periodoCalculado.periodo_inicio,
          periodo_fim: new Date(),
        }
      : null;

    if (!periodoAtual) {
      setErrorMessage("Não há solicitação anterior para definir o início da integração Olist.");
      return;
    }

    setIntegrandoOlist(true);
    setErrorMessage(null);
    setResumoImportacaoOlist(null);
    const resp = await axios.post(
      "/api/olist/gerar-solicitacao",
      {
        data_limite: formatarDataLocal(periodoAtual.periodo_fim),
        filtro_data_base: FILTRO_DATA_BASE_OLIST,
        periodo_inicio: periodoAtual.periodo_inicio.toISOString(),
        periodo_fim: periodoAtual.periodo_fim.toISOString(),
      },
      {
        validateStatus: () => true,
      },
    );
    const json = resp.data;
    if (resp.status < 200 || resp.status >= 300) {
      setErrorMessage(`Erro integração Olist: ${json.error ?? "desconhecido"}`);
      setIntegrandoOlist(false);
      return;
    }
    setResumoImportacaoOlist({
      pedidos_encontrados: Number(json.pedidos_encontrados ?? 0),
      pedidos_adicionados: Number(json.pedidos_adicionados ?? 0),
      pedidos_ignorados: Number(json.pedidos_ignorados ?? 0),
      motivo_pedidos_ignorados: String(json.motivo_pedidos_ignorados ?? "Pedido já processado anteriormente."),
    });
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
            Tipo de data
            <input readOnly value="Aprovação do pedido" className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600" />
          </label>
          {periodoCalculado && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                <strong>Período da integração:</strong>
              </p>
              <p>Início: {periodoCalculado.periodo_inicio.toLocaleString("pt-BR", { timeZone: TIME_ZONE })}</p>
              <p>Fim: {periodoCalculado.periodo_fim.toLocaleString("pt-BR", { timeZone: TIME_ZONE })}</p>
            </div>
          )}
          {!periodoCalculado && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Crie uma solicitação antes de gerar a próxima via Olist.
            </p>
          )}
          <button type="button" onClick={gerarViaOlist} disabled={integrandoOlist || !periodoCalculado} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {integrandoOlist ? "Integrando..." : "Gerar solicitação automaticamente"}
          </button>
          {resumoImportacaoOlist && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <p><strong>Pedidos encontrados:</strong> {resumoImportacaoOlist.pedidos_encontrados}</p>
              <p><strong>Pedidos adicionados:</strong> {resumoImportacaoOlist.pedidos_adicionados}</p>
              <p><strong>Pedidos ignorados:</strong> {resumoImportacaoOlist.pedidos_ignorados}</p>
              {resumoImportacaoOlist.pedidos_ignorados > 0 && (
                <p className="mt-1 text-slate-600">Motivo: {resumoImportacaoOlist.motivo_pedidos_ignorados}</p>
              )}
            </div>
          )}
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
                  <th className="p-3 text-right">Produtos</th>
                </tr>
              </thead>
              <tbody>
                {solicitacoes.map((solicitacao) => {
                  const aberta = Boolean(solicitacoesAbertas[solicitacao.id]);
                  const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];

                  return (
                    <Fragment key={solicitacao.id}>
                      <tr className="border-b border-slate-100">
                        <td className="p-3 text-slate-700">{new Date(`${solicitacao.data_entrega}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                        <td className="p-3 font-medium text-slate-700">{solicitacao.status === "em_producao" ? "EM_PRODUCAO" : solicitacao.status.toUpperCase()}</td>
                        <td className="p-3 text-slate-700">{qtdItensPorSolicitacao[solicitacao.id] ?? 0}</td>
                        <td className="p-3 text-slate-700">{new Date(solicitacao.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => alternarDetalhesSolicitacao(solicitacao.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={itensSolicitacao.length === 0}
                            title={aberta ? "Ocultar produtos" : "Ver produtos"}
                            aria-label={aberta ? "Ocultar produtos da solicitação" : "Ver produtos da solicitação"}
                            aria-expanded={aberta}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${aberta ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                      </tr>
                      {aberta && (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td className="p-3" colSpan={5}>
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-slate-600">
                                    <th className="px-3 py-2">SKU</th>
                                    <th className="px-3 py-2">Produto</th>
                                    <th className="px-3 py-2 text-right">Quantidade solicitada</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itensSolicitacao.map((item) => (
                                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                      <td className="px-3 py-2 font-medium text-slate-700">{item.sku}</td>
                                      <td className="px-3 py-2 text-slate-700">{item.nome}</td>
                                      <td className="px-3 py-2 text-right text-slate-700">{item.quantidade_solicitada}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
