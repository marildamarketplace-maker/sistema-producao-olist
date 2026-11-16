"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState("+55 37 8803-2390");
  const [loading, setLoading] = useState(true);
  const operacaoEmAndamento = useRef(false);
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
    return itensCarregados;
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

  async function abrirConfirmacao(solicitacao: Solicitacao) {
    if (operacaoEmAndamento.current) return;
    operacaoEmAndamento.current = true;
    setSavingId(solicitacao.id);
    setMessage(null);
    // Abre durante o clique para evitar bloqueio de popup após a chamada assíncrona.
    const novaAba = window.open("about:blank", "_blank");
    if (novaAba) novaAba.opener = null;
    try {
      if (!novaAba) throw new Error("Permita a abertura de novas abas para abrir a confirmação.");
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const response = await fetch(`/api/solicitacoes-producao/${encodeURIComponent(solicitacao.id)}/link-confirmacao`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const resultado = await response.json() as { token?: string; error?: string };
      if (!response.ok || !resultado.token) throw new Error(resultado.error ?? "Não foi possível abrir a confirmação.");
      novaAba.location.replace(`/confirmar-entrega-producao#token=${encodeURIComponent(resultado.token)}`);
    } catch (error) {
      novaAba?.close();
      setMessage(error instanceof Error ? error.message : "Não foi possível abrir a confirmação.");
    } finally {
      setSavingId(null);
      operacaoEmAndamento.current = false;
    }
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
            Consulte os itens nos detalhes e confirme as quantidades na tela pública de confirmação.
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

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
                  <Link
                    href={`/solicitacoes-producao/${encodeURIComponent(solicitacao.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Ver itens
                  </Link>
                  <button
                    type="button"
                    onClick={() => cobrarWhatsapp(solicitacao)}
                    disabled={carregandoItens || telefoneWhatsapp.replace(/\D/g, "").length === 0}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cobrar no WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => void abrirConfirmacao(solicitacao)}
                    disabled={savingId !== null || carregandoItens}
                    className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "Abrindo..." : "Confirmar produção"}
                  </button>
                </div>
              </div>

            </section>
          );
        })}
      </div>
    </AccessGuard>
  );
}
