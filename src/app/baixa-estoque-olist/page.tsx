"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ChevronDown } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type PedidoOlistBaixa = {
  id: string;
  itens: ItemBaixaForm[];
  detalhe_pendente?: boolean;
};

type ProdutoAusente = {
  sku: string;
};

type ItemBaixaForm = {
  sku: string;
  quantidade: string;
  pedido_olist_id: string;
  item_olist_id: string;
  observacao: string;
  produto_cadastrado?: boolean;
  detalhe_pendente?: boolean;
};

type ResultadoBusca = {
  periodo_inicio: string;
  periodo_fim: string;
  pedidos_encontrados: number;
  pedidos_ignorados: number;
  pedidos_detalhe_pendente?: number;
  aviso?: string | null;
  pedidos: PedidoOlistBaixa[];
  produtos_ausentes: ProdutoAusente[];
};

type PeriodoBuscaPadrao = {
  periodo_inicio: string;
  periodo_fim: string;
};

type BaixaHistorico = {
  id: string;
  origem: string;
  observacao: string | null;
  created_at: string;
};

type ItemBaixaHistorico = {
  id: string;
  baixa_id: string;
  sku: string;
  quantidade: number;
  pedido_olist_id: string | null;
  item_olist_id: string | null;
  observacao: string | null;
  origem: string;
  created_at: string;
};

const ITEM_INICIAL: ItemBaixaForm = {
  sku: "",
  quantidade: "1",
  pedido_olist_id: "",
  item_olist_id: "",
  observacao: "",
  produto_cadastrado: true,
};

function formatarDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}

function isoParaDateTimeLocal(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  return formatarDateTimeLocal(date);
}

function dateTimeLocalParaIso(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

export default function BaixaEstoqueOlistPage() {
  const { session, usuario } = useAuth();
  const [resultadoBusca, setResultadoBusca] = useState<ResultadoBusca | null>(null);
  const [pedidosSelecionados, setPedidosSelecionados] = useState<string[]>([]);
  const [itensForm, setItensForm] = useState<ItemBaixaForm[]>([{ ...ITEM_INICIAL }]);
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [modoAtual, setModoAtual] = useState<"automatica" | "manual">("manual");
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [pedidoSincronizando, setPedidoSincronizando] = useState<string | null>(null);
  const [formBaixaOpen, setFormBaixaOpen] = useState(false);
  const [historicoBaixas, setHistoricoBaixas] = useState<BaixaHistorico[]>([]);
  const [itensHistorico, setItensHistorico] = useState<ItemBaixaHistorico[]>([]);
  const [historicoAberto, setHistoricoAberto] = useState<Record<string, boolean>>({});
  const [loadingHistorico, setLoadingHistorico] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [periodoInicioBusca, setPeriodoInicioBusca] = useState("");
  const podeSolicitarBaixa = Boolean(usuario?.podeSolicitarBaixa);

  const itensPorBaixa = useMemo(() => {
    return itensHistorico.reduce<Record<string, ItemBaixaHistorico[]>>((acc, item) => {
      acc[item.baixa_id] = [...(acc[item.baixa_id] ?? []), item];
      return acc;
    }, {});
  }, [itensHistorico]);

  async function carregarHistoricoBaixas() {
    setLoadingHistorico(true);

    const [baixasResp, itensResp] = await Promise.all([
      supabase
        .from("baixas_estoque_olist")
        .select("id, origem, observacao, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("itens_baixa_estoque_olist")
        .select("id, baixa_id, sku, quantidade, pedido_olist_id, item_olist_id, observacao, origem, created_at")
        .order("created_at", { ascending: true }),
    ]);

    if (baixasResp.error || itensResp.error) {
      setErrorMessage(baixasResp.error?.message ?? itensResp.error?.message ?? "Erro ao carregar histórico de baixas.");
      setLoadingHistorico(false);
      return;
    }

    setHistoricoBaixas((baixasResp.data as BaixaHistorico[]) ?? []);
    setItensHistorico((itensResp.data as ItemBaixaHistorico[]) ?? []);
    setLoadingHistorico(false);
  }

  useEffect(() => {
    carregarHistoricoBaixas();
  }, []);

  useEffect(() => {
    async function carregarPeriodoBuscaPadrao() {
      if (!podeSolicitarBaixa) return;

      const resp = await axios.get("/api/olist/baixa-estoque/buscar", { validateStatus: () => true });

      if (resp.status < 200 || resp.status >= 300) return;

      const data = resp.data as PeriodoBuscaPadrao;
      setPeriodoInicioBusca(isoParaDateTimeLocal(data.periodo_inicio));
    }

    void carregarPeriodoBuscaPadrao();
  }, [podeSolicitarBaixa]);

  function alternarHistoricoBaixa(baixaId: string) {
    setHistoricoAberto((anterior) => ({
      ...anterior,
      [baixaId]: !anterior[baixaId],
    }));
  }

  async function buscarPedidosOlist() {
    if (!podeSolicitarBaixa) return;

    setBuscando(true);
    setMessage(null);
    setErrorMessage(null);

    const periodoInicio = periodoInicioBusca ? dateTimeLocalParaIso(periodoInicioBusca) : null;

    if (periodoInicioBusca && !periodoInicio) {
      setErrorMessage("Informe uma data válida para a busca automática.");
      setBuscando(false);
      return;
    }

    const resp = await axios.post(
      "/api/olist/baixa-estoque/buscar",
      { periodo_inicio: periodoInicio },
      { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, validateStatus: () => true },
    );

    if (resp.status < 200 || resp.status >= 300) {
      setErrorMessage(`Erro ao buscar pedidos Olist: ${resp.data?.error ?? "erro desconhecido"}`);
      setBuscando(false);
      return;
    }

    const data = resp.data as ResultadoBusca;
    setResultadoBusca(data);
    setPeriodoInicioBusca(isoParaDateTimeLocal(data.periodo_inicio));
    setPedidosSelecionados([]);
    setItensForm([{ ...ITEM_INICIAL }]);
    setModoAtual("automatica");
    setFormBaixaOpen(false);
    setMessage(
      data.aviso ||
        `Busca concluida. Pedidos encontrados: ${data.pedidos_encontrados}. Ignorados por baixa anterior: ${data.pedidos_ignorados}.`,
    );
    setBuscando(false);
  }

  function preencherItensSelecionados(idsSelecionados: string[]) {
    if (!podeSolicitarBaixa) return;

    const pedidos = resultadoBusca?.pedidos ?? [];
    const itens = pedidos
      .filter((pedido) => idsSelecionados.includes(pedido.id))
      .flatMap((pedido) =>
        pedido.itens.map((item) => ({
          ...item,
          quantidade: String(item.quantidade),
          pedido_olist_id: pedido.id,
          observacao: item.observacao || `Baixa automatica Olist ${pedido.id}`,
        })),
      );

    setItensForm(itens.length ? itens : [{ ...ITEM_INICIAL }]);
  }

  function alternarPedido(pedidoId: string) {
    if (!podeSolicitarBaixa) return;

    const proximos = pedidosSelecionados.includes(pedidoId)
      ? pedidosSelecionados.filter((id) => id !== pedidoId)
      : [...pedidosSelecionados, pedidoId];

    setPedidosSelecionados(proximos);
    preencherItensSelecionados(proximos);
    setModoAtual("automatica");
    setFormBaixaOpen(true);
  }

  function alternarTodosPedidos() {
    if (!podeSolicitarBaixa) return;

    const pedidos = resultadoBusca?.pedidos ?? [];
    const todosSelecionados =
      pedidos.length > 0 && pedidos.every((pedido) => pedidosSelecionados.includes(pedido.id));
    const proximos = todosSelecionados ? [] : pedidos.map((pedido) => pedido.id);

    setPedidosSelecionados(proximos);
    preencherItensSelecionados(proximos);
    setModoAtual("automatica");
    setFormBaixaOpen(true);
  }

  function alterarItem(index: number, patch: Partial<ItemBaixaForm>) {
    if (!podeSolicitarBaixa) return;

    setItensForm((anteriores) =>
      anteriores.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  async function sincronizarPedidoOlist(index: number) {
    if (!podeSolicitarBaixa) return;

    const pedidoId = itensForm[index]?.pedido_olist_id?.trim();

    if (!pedidoId) {
      setErrorMessage("Informe o pedido Olist para sincronizar.");
      return;
    }

    setPedidoSincronizando(pedidoId);
    setMessage(null);
    setErrorMessage(null);

    const resp = await axios.post(
      "/api/olist/baixa-estoque/sincronizar",
      { pedido_olist_id: pedidoId },
      { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, validateStatus: () => true },
    );

    if (resp.status < 200 || resp.status >= 300) {
      setErrorMessage(`Erro ao sincronizar pedido: ${resp.data?.error ?? "erro desconhecido"}`);
      setPedidoSincronizando(null);
      return;
    }

    const pedido = resp.data?.pedido as PedidoOlistBaixa | undefined;
    const produtosAusentes = (resp.data?.produtos_ausentes ?? []) as ProdutoAusente[];

    if (!pedido?.itens?.length) {
      setErrorMessage("Pedido sincronizado, mas nenhum item foi retornado pela Olist.");
      setPedidoSincronizando(null);
      return;
    }

    const itensSincronizados = pedido.itens.map((item) => ({
      ...item,
      quantidade: String(item.quantidade),
      pedido_olist_id: pedido.id,
      observacao: item.observacao || `Baixa automatica Olist ${pedido.id}`,
      detalhe_pendente: false,
    }));

    setItensForm((anteriores) => {
      const semPedido = anteriores.filter((item) => item.pedido_olist_id !== pedido.id);
      const posicaoInsercao = Math.min(index, semPedido.length);

      return [
        ...semPedido.slice(0, posicaoInsercao),
        ...itensSincronizados,
        ...semPedido.slice(posicaoInsercao),
      ];
    });

    setResultadoBusca((anterior) => {
      if (!anterior) return anterior;

      const ausentes = new Map(anterior.produtos_ausentes.map((produto) => [produto.sku, produto]));
      produtosAusentes.forEach((produto) => ausentes.set(produto.sku, produto));

      return {
        ...anterior,
        pedidos: anterior.pedidos.map((pedidoAtual) =>
          pedidoAtual.id === pedido.id ? { ...pedido, itens: itensSincronizados, detalhe_pendente: false } : pedidoAtual,
        ),
        produtos_ausentes: [...ausentes.values()],
        pedidos_detalhe_pendente: Math.max(0, (anterior.pedidos_detalhe_pendente ?? 0) - 1),
      };
    });

    setMessage(`Pedido ${pedido.id} sincronizado com sucesso.`);
    setPedidoSincronizando(null);
  }

  function adicionarItemManual() {
    if (!podeSolicitarBaixa) return;

    setModoAtual("manual");
    setPedidosSelecionados([]);
    setItensForm((anteriores) => [...anteriores, { ...ITEM_INICIAL, produto_cadastrado: undefined }]);
  }

  function limparParaManual() {
    if (!podeSolicitarBaixa) return;

    setModoAtual("manual");
    setPedidosSelecionados([]);
    setItensForm([{ ...ITEM_INICIAL, produto_cadastrado: undefined }]);
    setFormBaixaOpen(true);
    setMessage(null);
    setErrorMessage(null);
  }

  function removerItem(index: number) {
    if (!podeSolicitarBaixa) return;

    setItensForm((anteriores) =>
      anteriores.length > 1 ? anteriores.filter((_, i) => i !== index) : anteriores,
    );
  }

  async function confirmarBaixa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeSolicitarBaixa) return;

    setSalvando(true);
    setMessage(null);
    setErrorMessage(null);

    const itens = itensForm.map((item) => ({
      sku: item.sku.trim(),
      quantidade: Number(item.quantidade),
      pedido_olist_id: item.pedido_olist_id.trim() || null,
      item_olist_id: item.item_olist_id.trim() || null,
      observacao: item.observacao.trim() || null,
    }));

    const itemInvalido = itens.find((item) => !item.sku || Number.isNaN(item.quantidade) || item.quantidade <= 0);

    if (itemInvalido) {
      setErrorMessage("Preencha SKU, descricao e quantidade valida para todos os itens.");
      setSalvando(false);
      return;
    }

    const resp = await axios.post(
      "/api/olist/baixa-estoque/confirmar",
      {
        origem: modoAtual,
        observacao: observacaoGeral,
        periodo_fim_busca: modoAtual === "automatica" ? resultadoBusca?.periodo_fim ?? null : null,
        itens,
      },
      { validateStatus: () => true },
    );

    if (resp.status < 200 || resp.status >= 300) {
      setErrorMessage(`Erro ao confirmar baixa: ${resp.data?.error ?? "erro desconhecido"}`);
      setSalvando(false);
      return;
    }

    setMessage(`Baixa registrada com sucesso. Itens baixados: ${resp.data?.itens ?? itens.length}.`);
    setResultadoBusca(null);
    setItensForm([{ ...ITEM_INICIAL }]);
    setPedidosSelecionados([]);
    setObservacaoGeral("");
    setModoAtual("manual");
    setFormBaixaOpen(false);
    await carregarHistoricoBaixas();
    setSalvando(false);
  }

  return (
    <AccessGuard permissions={["podeVisualizarBaixa", "podeSolicitarBaixa"]}>
      <div className="space-y-8">
      <PageHeader
        title="Baixa de Estoque por Pedidos Olist"
        description="Busque pedidos enviados pela Olist ou registre baixas manuais com histórico."
      />

      {podeSolicitarBaixa && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Busca automática Olist</h3>
            <p className="mt-1 text-sm text-slate-600">
              Situações consultadas: Pronto envio, Enviada e Entregue.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="text-sm text-slate-700">
              Buscar desde
              <input
                type="datetime-local"
                value={periodoInicioBusca}
                onChange={(event) => setPeriodoInicioBusca(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 md:w-56"
              />
            </label>
            <button
              type="button"
              onClick={buscarPedidosOlist}
              disabled={buscando}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {buscando ? "Buscando..." : "Buscar pedidos Olist"}
            </button>
          </div>
        </div>

        {resultadoBusca && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>Periodo: {new Date(resultadoBusca.periodo_inicio).toLocaleString("pt-BR")} ate {new Date(resultadoBusca.periodo_fim).toLocaleString("pt-BR")}</p>
              <p>Pedidos encontrados: {resultadoBusca.pedidos_encontrados}</p>
              <p>Pedidos ignorados por baixa anterior: {resultadoBusca.pedidos_ignorados}</p>
              {(resultadoBusca.pedidos_detalhe_pendente ?? 0) > 0 && (
                <p>Pedidos pendentes de detalhe: {resultadoBusca.pedidos_detalhe_pendente}</p>
              )}
            </div>

            {resultadoBusca.aviso && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {resultadoBusca.aviso}
              </div>
            )}

            {resultadoBusca.produtos_ausentes.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>Produtos ausentes no estoque:</strong>{" "}
                {resultadoBusca.produtos_ausentes.map((produto) => `${produto.sku}`).join(", ")}
              </div>
            )}

            {resultadoBusca.pedidos.length === 0 ? (
              <p className="text-sm text-slate-600">Nenhum pedido novo elegível para baixa.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="p-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={
                              resultadoBusca.pedidos.length > 0 &&
                              resultadoBusca.pedidos.every((pedido) => pedidosSelecionados.includes(pedido.id))
                            }
                            onChange={alternarTodosPedidos}
                          />
                          Todos
                        </label>
                      </th>
                      <th className="p-3">Pedido Olist</th>
                      <th className="p-3">Itens</th>
                      <th className="p-3">Produtos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadoBusca.pedidos.map((pedido) => (
                      <tr key={pedido.id} className="border-b border-slate-100">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={pedidosSelecionados.includes(pedido.id)}
                            onChange={() => alternarPedido(pedido.id)}
                          />
                        </td>
                        <td className="p-3 font-medium text-slate-700">{pedido.id}</td>
                        <td className="p-3 text-slate-700">
                          {pedido.detalhe_pendente ? "Pendente" : pedido.itens.length}
                        </td>
                        <td className="p-3 text-slate-700">
                          {pedido.detalhe_pendente
                            ? "Sincronize o pedido no formulario"
                            : pedido.itens.map((item) => `${item.sku} (${item.quantidade})`).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {podeSolicitarBaixa && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Formulário de baixa de estoque</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={limparParaManual}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              Nova baixa manual
            </button>
            <button
              type="button"
              onClick={() => setFormBaixaOpen((prev) => !prev)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              aria-expanded={formBaixaOpen}
            >
              {formBaixaOpen ? "Fechar" : "Abrir"}
            </button>
          </div>
        </div>

        {formBaixaOpen && (
        <form className="space-y-4" onSubmit={confirmarBaixa}>
          <label className="block text-sm text-slate-700">
            Observação geral
            <input
              value={observacaoGeral}
              onChange={(event) => setObservacaoGeral(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="space-y-3">
            {itensForm.map((item, index) => {
              const itemAutomatico = Boolean(item.pedido_olist_id);

              return (
              <div key={index} className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-6">
                <label className="text-sm text-slate-700">
                  SKU/referência
                  <input
                    required
                    disabled={itemAutomatico}
                    value={item.sku}
                    onChange={(event) => alterarItem(index, { sku: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-600"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Quantidade
                  <input
                    required
                    min={1}
                    type="number"
                    value={item.quantidade}
                    onChange={(event) => alterarItem(index, { quantidade: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="text-sm text-slate-700">
                  Pedido Olist
                  <div className="mt-1 flex gap-2">
                    <input
                      disabled={itemAutomatico}
                      value={item.pedido_olist_id}
                      onChange={(event) => alterarItem(index, { pedido_olist_id: event.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-600"
                    />
                    {itemAutomatico && (
                      <button
                        type="button"
                        onClick={() => sincronizarPedidoOlist(index)}
                        disabled={pedidoSincronizando === item.pedido_olist_id}
                        className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50"
                      >
                        {pedidoSincronizando === item.pedido_olist_id ? "..." : "Sincronizar"}
                      </button>
                    )}
                  </div>
                </div>
                <label className="text-sm text-slate-700">
                  Observação
                  <input
                    value={item.observacao}
                    onChange={(event) => alterarItem(index, { observacao: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="md:col-span-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removerItem(index)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                  >
                    Remover item
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 md:flex-row">
            <button
              type="button"
              onClick={adicionarItemManual}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              + Adicionar item manual
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {salvando ? "Confirmando..." : "Confirmar baixa de estoque"}
            </button>
          </div>
        </form>
        )}

        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
        {errorMessage && <p className="mt-4 text-sm text-red-600">{errorMessage}</p>}
      </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Histórico de confirmações de baixa</h3>

        {loadingHistorico ? (
          <p className="text-sm text-slate-600">Carregando histórico...</p>
        ) : historicoBaixas.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma baixa confirmada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Data</th>
                  <th className="p-3">Origem</th>
                  <th className="p-3">Observação</th>
                  <th className="p-3">Itens</th>
                  <th className="p-3 text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {historicoBaixas.map((baixa) => {
                  const aberta = Boolean(historicoAberto[baixa.id]);
                  const itensBaixa = itensPorBaixa[baixa.id] ?? [];

                  return (
                    <Fragment key={baixa.id}>
                      <tr className="border-b border-slate-100">
                        <td className="p-3 text-slate-700">{new Date(baixa.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-3 font-medium uppercase text-slate-700">{baixa.origem}</td>
                        <td className="p-3 text-slate-700">{baixa.observacao || "-"}</td>
                        <td className="p-3 text-slate-700">{itensBaixa.length}</td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => alternarHistoricoBaixa(baixa.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={itensBaixa.length === 0}
                            title={aberta ? "Ocultar itens" : "Ver itens"}
                            aria-label={aberta ? "Ocultar itens baixados" : "Ver itens baixados"}
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
                                    <th className="px-3 py-2">Quantidade</th>
                                    <th className="px-3 py-2">Pedido Olist</th>
                                    <th className="px-3 py-2">Observação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itensBaixa.map((item) => (
                                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                      <td className="px-3 py-2 font-medium text-slate-700">{item.sku}</td>
                                      <td className="px-3 py-2 font-semibold text-slate-900">{item.quantidade}</td>
                                      <td className="px-3 py-2 text-slate-700">{item.pedido_olist_id || "-"}</td>
                                      <td className="px-3 py-2 text-slate-700">{item.observacao || "-"}</td>
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
    </AccessGuard>
  );
}
