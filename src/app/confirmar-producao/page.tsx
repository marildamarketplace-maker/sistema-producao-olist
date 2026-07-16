"use client";

import { useCallback, useEffect, useState } from "react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Solicitacao = {
  id: string;
  data_entrega: string;
  status: string;
  created_at: string;
  observacao_geral: string | null;
  prioridade_producao: boolean | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
};

type ItemSolicitacao = {
  id: string;
  solicitacao_id: string;
  produto_id: string;
  sku: string;
  imagem_url: string | null;
  quantidade_solicitada: number;
  quantidade_produzida: number;
  tipo_corte: string | null;
  observacao: string | null;
};

function formatarStatus(status: string) {
  return status === "em_producao" ? "EM_PRODUCAO" : status.toUpperCase();
}

function formatarDataEntrega(dataEntrega: string) {
  return new Date(`${dataEntrega}T00:00:00`).toLocaleDateString("pt-BR");
}

export default function ConfirmarProducaoPage() {
  const { session } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [pedidosOlistPorSolicitacao, setPedidosOlistPorSolicitacao] = useState<Record<string, string[]>>({});
  const [itensPorSolicitacao, setItensPorSolicitacao] = useState<Record<string, ItemSolicitacao[]>>({});
  const [itensCarregando, setItensCarregando] = useState<Record<string, boolean>>({});
  const [solicitacoesAbertas, setSolicitacoesAbertas] = useState<Record<string, boolean>>({});
  const [produzidas, setProduzidas] = useState<Record<string, string>>({});
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState("+55 37 8803-2390");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const carregarDados = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    if (!session?.access_token) {
      setMessage("Sessão expirada.");
      setLoading(false);
      return;
    }

    const [solicitacoesResp, pedidosResponse] = await Promise.all([
      supabase
        .from("solicitacoes_producao")
        .select(
          "id, data_entrega, status, created_at, observacao_geral, prioridade_producao, periodo_inicio, periodo_fim",
        )
        .eq("status", "em_producao")
        .order("prioridade_producao", { ascending: false })
        .order("created_at", { ascending: false }),
      fetch("/api/solicitacoes-producao/pedidos-fornecedor", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
    ]);

    if (solicitacoesResp.error) {
      setMessage(solicitacoesResp.error.message ?? "Erro ao carregar dados.");
      setLoading(false);
      return;
    }

    const pedidosJson = await pedidosResponse.json() as {
      pedidos?: Array<{ solicitacaoId: string; pedidoOlistId: string }>;
      error?: string;
    };
    if (!pedidosResponse.ok) {
      setMessage(pedidosJson.error ?? "Erro ao carregar IDs dos pedidos Olist.");
      setLoading(false);
      return;
    }

    const listaSolicitacoes = [...((solicitacoesResp.data as Solicitacao[]) ?? [])].sort((a, b) => {
      const prioridadeA = a.prioridade_producao ? 1 : 0;
      const prioridadeB = b.prioridade_producao ? 1 : 0;

      if (prioridadeA !== prioridadeB) return prioridadeB - prioridadeA;

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    setSolicitacoes(listaSolicitacoes);
    const pedidosAgrupados: Record<string, string[]> = {};
    for (const pedido of pedidosJson.pedidos ?? []) {
      pedidosAgrupados[pedido.solicitacaoId] ??= [];
      pedidosAgrupados[pedido.solicitacaoId].push(pedido.pedidoOlistId);
    }
    setPedidosOlistPorSolicitacao(pedidosAgrupados);
    setItensPorSolicitacao({});
    setItensCarregando({});
    setSolicitacoesAbertas({});
    setProduzidas({});
    setLoading(false);
  }, [session?.access_token]);

  async function carregarItensSolicitacao(solicitacaoId: string, force = false) {
    if (!force && itensPorSolicitacao[solicitacaoId]) {
      return itensPorSolicitacao[solicitacaoId];
    }

    setItensCarregando((prev) => ({ ...prev, [solicitacaoId]: true }));
    setMessage(null);

    const { data, error } = await supabase
      .from("itens_solicitacao_producao")
      .select(
        "id, solicitacao_id, produto_id, sku, imagem_url, quantidade_solicitada, quantidade_produzida, tipo_corte, observacao",
      )
      .eq("solicitacao_id", solicitacaoId)
      .order("created_at", { ascending: true });

    setItensCarregando((prev) => ({ ...prev, [solicitacaoId]: false }));

    if (error) {
      setMessage(`Erro ao carregar itens: ${error.message}`);
      return null;
    }

    const itensCarregados = (data as ItemSolicitacao[]) ?? [];
    setItensPorSolicitacao((prev) => ({ ...prev, [solicitacaoId]: itensCarregados }));
    setProduzidas((prev) => {
      const proximo = { ...prev };

      itensCarregados.forEach((item) => {
        proximo[item.id] = proximo[item.id] ?? String(item.quantidade_solicitada ?? 0);
      });

      return proximo;
    });

    return itensCarregados;
  }

  async function alternarDetalhesSolicitacao(solicitacaoId: string) {
    const vaiAbrir = !solicitacoesAbertas[solicitacaoId];

    setSolicitacoesAbertas((prev) => ({ ...prev, [solicitacaoId]: vaiAbrir }));

    if (vaiAbrir) {
      await carregarItensSolicitacao(solicitacaoId);
    }
  }

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function montarRelatorioWhatsapp(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    const linhas = itensSolicitacao.map((item) => {
      const observacao = item.observacao?.trim();
      return observacao
        ? `${item.quantidade_solicitada} - ${item.sku} | Obs: ${observacao}`
        : `${item.quantidade_solicitada} - ${item.sku}`;
    });
    const observacaoGeral = solicitacao.observacao_geral?.trim();
    const cabecalho = solicitacao.prioridade_producao
      ? ["🚨🚨 PRIORIDADE 🚨🚨", "Produção prioritária. Pode confirmar esta solicitação com urgência?"]
      : ["Olá! Pode confirmar a produção desta solicitação?"];

    return [
      ...cabecalho,
      "",
      `Entrega: ${formatarDataEntrega(solicitacao.data_entrega)}`,
      "",
      "Itens:",
      ...linhas,
      ...(observacaoGeral ? ["", `Observacao geral: ${observacaoGeral}`] : []),
    ].join("\n");
  }

  function montarLinkWhatsapp(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    const telefone = telefoneWhatsapp.replace(/\D/g, "");
    const texto = montarRelatorioWhatsapp(solicitacao, itensSolicitacao);

    return `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
  }

  async function cobrarWhatsapp(solicitacao: Solicitacao) {
    const itensSolicitacao = await carregarItensSolicitacao(solicitacao.id);

    if (!itensSolicitacao?.length) {
      setMessage("Solicitação sem itens cadastrados.");
      return;
    }

    const link = montarLinkWhatsapp(solicitacao, itensSolicitacao);
    window.open(link, "_blank", "noopener,noreferrer");
  }

  async function confirmarProducao(solicitacao: Solicitacao) {
    const itensSolicitacao = await carregarItensSolicitacao(solicitacao.id);
    if (!itensSolicitacao?.length) {
      setMessage("Solicitação sem itens cadastrados.");
      return;
    }

    setSavingId(solicitacao.id);
    setMessage(null);

    const atualizacoes = itensSolicitacao.map((item) => {
      const qtd = Number(produzidas[item.id] ?? item.quantidade_solicitada ?? 0);
      return { item, qtd };
    });

    const invalido = atualizacoes.find(({ qtd }) => Number.isNaN(qtd) || qtd < 0);
    if (invalido) {
      setMessage("Informe quantidades produzidas válidas (>= 0).");
      setSavingId(null);
      return;
    }

    for (const { item, qtd } of atualizacoes) {
      const { error: updateError } = await supabase
        .from("itens_solicitacao_producao")
        .update({ quantidade_produzida: qtd })
        .eq("id", item.id);

      if (updateError) {
        setMessage(`Erro ao atualizar item ${item.sku}: ${updateError.message}`);
        setSavingId(null);
        return;
      }

      if (qtd > 0) {
        const { error: movError } = await supabase.from("movimentacoes_estoque").insert({
          produto_id: item.produto_id,
          sku: item.sku,
          tipo_movimento: "entrada",
          quantidade: qtd,
          origem: "PRODUCAO",
          referencia_id: solicitacao.id,
          observacao: "Entrada por confirmação de produção",
        });

        if (movError) {
          setMessage(`Erro ao criar movimentação de ${item.sku}: ${movError.message}`);
          setSavingId(null);
          return;
        }
      }
    }

    const { error: statusError } = await supabase
      .from("solicitacoes_producao")
      .update({ status: "concluida" })
      .eq("id", solicitacao.id);

    if (statusError) {
      setMessage(`Erro ao concluir solicitação: ${statusError.message}`);
      setSavingId(null);
      return;
    }

    setMessage("Solicitação confirmada com sucesso.");
    await carregarDados();
    setSavingId(null);
  }

  return (
    <AccessGuard permissions={["podeConfirmarProducao"]}>
      <div className="space-y-8">
      <PageHeader
        title="Confirmar Produção"
        description="Confirme quantidades produzidas e gere entradas de estoque por solicitação."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Solicitações pendentes de confirmação</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando solicitações...</p>
        ) : solicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Não há solicitações pendentes de confirmação.</p>
        ) : (
          <p className="text-sm text-slate-600">
            Todas as solicitações ainda não confirmadas aparecem abaixo, com seus itens abertos.
          </p>
        )}

        {message && <p className="mt-3 text-sm text-slate-700">{message}</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <label className="block text-sm font-medium text-slate-700 md:max-w-sm">
          Telefone para cobrança via WhatsApp
          <input
            value={telefoneWhatsapp}
            onChange={(event) => setTelefoneWhatsapp(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal"
            placeholder="+55 37 8803-2390"
          />
        </label>
      </section>

      {!loading &&
        solicitacoes.map((solicitacao) => {
          const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];
          const aberta = Boolean(solicitacoesAbertas[solicitacao.id]);
          const itensJaCarregados = Boolean(itensPorSolicitacao[solicitacao.id]);
          const carregandoItens = Boolean(itensCarregando[solicitacao.id]);
          const saving = savingId === solicitacao.id;

          return (
            <section key={solicitacao.id} className="rounded-lg border border-slate-200 bg-white p-6">
              {solicitacao.prioridade_producao ? (
                <div className="mb-4 rounded-md border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-black uppercase tracking-wide text-red-700">
                  PRIORIDADE
                </div>
              ) : null}

              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">
                      Entrega {formatarDataEntrega(solicitacao.data_entrega)}
                    </h3>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      {formatarStatus(solicitacao.status)}
                    </span>
                  </div>

                  <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                    <p>
                      <strong>Criada em:</strong> {new Date(solicitacao.created_at).toLocaleString("pt-BR")}
                    </p>
                    <p>
                      <strong>Itens:</strong> {itensJaCarregados ? itensSolicitacao.length : "Ao abrir"}
                    </p>
                    <p className="md:col-span-2">
                      <strong>ID pedido Olist:</strong>{" "}
                      {(pedidosOlistPorSolicitacao[solicitacao.id] ?? []).join(", ") || "-"}
                    </p>
                    <p className="md:col-span-2">
                      <strong>Observação geral:</strong> {solicitacao.observacao_geral || "-"}
                    </p>
                    {(solicitacao.periodo_inicio || solicitacao.periodo_fim) && (
                      <p className="md:col-span-2">
                        <strong>Período Olist:</strong>{" "}
                        {solicitacao.periodo_inicio
                          ? new Date(solicitacao.periodo_inicio).toLocaleString("pt-BR")
                          : "-"}{" "}
                        até{" "}
                        {solicitacao.periodo_fim ? new Date(solicitacao.periodo_fim).toLocaleString("pt-BR") : "-"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                  <button
                    type="button"
                    onClick={() => alternarDetalhesSolicitacao(solicitacao.id)}
                    disabled={carregandoItens}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    aria-expanded={aberta}
                  >
                    {aberta ? "Ocultar itens" : carregandoItens ? "Carregando..." : "Ver itens"}
                  </button>
                  <button
                    type="button"
                    onClick={() => cobrarWhatsapp(solicitacao)}
                    disabled={carregandoItens || telefoneWhatsapp.replace(/\D/g, "").length === 0}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cobrar no WhatsApp
                  </button>
                  <button
                    onClick={() => confirmarProducao(solicitacao)}
                    disabled={savingId !== null || carregandoItens}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "Confirmando..." : "Confirmar produção"}
                  </button>
                </div>
              </div>

              {!aberta ? (
                <p className="text-sm text-slate-600">Abra os itens para conferir os produtos desta solicitação.</p>
              ) : carregandoItens ? (
                <p className="text-sm text-slate-600">Carregando itens...</p>
              ) : itensSolicitacao.length === 0 ? (
                <p className="text-sm text-slate-600">Solicitação sem itens cadastrados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-600">
                        <th className="p-3">Imagem</th>
                        <th className="p-3">SKU</th>
                        <th className="p-3">Qtd. solicitada</th>
                        <th className="p-3">Qtd. produzida</th>
                        <th className="p-3">Corte a laser</th>
                        <th className="p-3">Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itensSolicitacao.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="p-3">
                            {item.imagem_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.imagem_url} alt={item.sku} className="h-12 w-12 rounded object-cover" />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
                                Sem imagem
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-medium text-slate-700">{item.sku}</td>
                          <td className="p-3 text-slate-700">{item.quantidade_solicitada}</td>
                          <td className="p-3">
                            <input
                              type="number"
                              min={0}
                              value={produzidas[item.id] ?? String(item.quantidade_solicitada ?? 0)}
                              onChange={(event) =>
                                setProduzidas((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value,
                                }))
                              }
                              className="w-28 rounded-md border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="p-3 text-slate-700">{item.tipo_corte === "LASER" ? "Sim" : "Não"}</td>
                          <td className="p-3 text-slate-700">{item.observacao || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </AccessGuard>
  );
}
