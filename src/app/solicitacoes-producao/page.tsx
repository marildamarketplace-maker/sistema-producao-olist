"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ChevronDown, Download, Pencil, Printer, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
};

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
  quantidade_solicitada: number;
  tipo_corte: string | null;
  observacao: string | null;
};

type ItemForm = {
  id?: string;
  produto_id: string;
  produto_busca: string;
  quantidade_solicitada: string;
  corte_laser: boolean;
  observacao: string;
  prioridade_producao?: boolean;
  existe_em_producao?: boolean;
  quantidade_em_producao?: number;
};

type ItemPreparadoOlist = {
  produto_id: string;
  quantidade_solicitada: number;
  prioridade_producao?: boolean;
  existe_em_producao?: boolean;
  quantidade_em_producao?: number;
};

type RastreioOlist = {
  pedido_olist_id: string;
  item_olist_id: string;
  sku: string;
};

type ProcessamentoOlistPendente = {
  periodo_inicio: string;
  periodo_fim: string;
  itens: RastreioOlist[];
};

type ResultadoImportacaoOlist = {
  pedidos_encontrados: number;
  pedidos_adicionados: number;
  pedidos_ignorados: number;
  motivo_pedidos_ignorados: string;
  total_itens: number;
  produtos_cadastrados: number;
};

type ItemEstoqueSuficiente = {
  sku: string;
  estoque_atual: number;
  quantidade_pedidos: number;
  estoque_apos_pedidos: number;
  minimo_estoque: number;
};

type ItemDashboardPendente = {
  produto_id: string;
  sku: string;
  quantidade_solicitada: number;
  observacao?: string;
};

const FILTRO_DATA_BASE_OLIST = "APROVACAO_PEDIDO";
const TIME_ZONE = "America/Sao_Paulo";
const SITUACOES_OLIST_PADRAO = ["3", "4", "1"];
const DASHBOARD_SOLICITACAO_KEY = "dashboard_solicitacao_manual_itens";

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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatarStatus(status: string) {
  return status === "em_producao" ? "EM_PRODUCAO" : status.toUpperCase();
}

function formatarDataEntrega(dataEntrega: string) {
  return new Date(`${dataEntrega}T00:00:00`).toLocaleDateString("pt-BR");
}

function arredondarParaPar(valor: number) {
  return valor % 2 === 0 ? valor : valor + 1;
}

function normalizarQuantidadePar(valor: string) {
  const quantidade = Number(valor);

  if (Number.isNaN(quantidade) || quantidade < 0) return "0";

  return String(arredondarParaPar(Math.ceil(quantidade)));
}

const ITEM_INICIAL: ItemForm = {
  produto_id: "",
  produto_busca: "",
  quantidade_solicitada: "2",
  corte_laser: true,
  observacao: "",
};

const ORDEM_STATUS_SOLICITACAO: Record<string, number> = {
  em_producao: 0,
  concluida: 1,
  cancelada: 2,
};

function ordenarSolicitacoes(a: Solicitacao, b: Solicitacao) {
  const ordemA = ORDEM_STATUS_SOLICITACAO[a.status] ?? 99;
  const ordemB = ORDEM_STATUS_SOLICITACAO[b.status] ?? 99;

  if (ordemA !== ordemB) return ordemA - ordemB;

  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export default function SolicitacoesProducaoPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [itens, setItens] = useState<ItemSolicitacao[]>([]);
  const [dataEntrega, setDataEntrega] = useState("");
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [itensForm, setItensForm] = useState<ItemForm[]>([{ ...ITEM_INICIAL }]);
  const [produtoBuscaAberta, setProdutoBuscaAberta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solicitacoesAbertas, setSolicitacoesAbertas] = useState<Record<string, boolean>>({});
  const [solicitacaoEditandoId, setSolicitacaoEditandoId] = useState<string | null>(null);

  const [agoraOlist, setAgoraOlist] = useState(() => new Date());
  const situacoesOlistSelecionadas = SITUACOES_OLIST_PADRAO;
  const [integrandoOlist, setIntegrandoOlist] = useState(false);
  const [resumoImportacaoOlist, setResumoImportacaoOlist] = useState<ResultadoImportacaoOlist | null>(null);
  const [processamentoOlistPendente, setProcessamentoOlistPendente] = useState<ProcessamentoOlistPendente | null>(null);
  const [prioridadeProducao, setPrioridadeProducao] = useState(false);

  const ultimaSolicitacaoCriada = useMemo(() => {
    return solicitacoes.reduce<Solicitacao | null>((maisRecente, solicitacao) => {
      if (!maisRecente) return solicitacao;

      const dataAtual = new Date(solicitacao.created_at);
      const dataMaisRecente = new Date(maisRecente.created_at);

      return dataAtual > dataMaisRecente ? solicitacao : maisRecente;
    }, null);
  }, [solicitacoes]);

  const periodoCalculado = useMemo(() => {
    const periodoInicio = ultimaSolicitacaoCriada
      ? new Date(ultimaSolicitacaoCriada.created_at)
      : new Date(agoraOlist.getFullYear(), 0, 1, 0, 0, 0);

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
      supabase.from("produtos").select("id, sku, imagem_url").eq("ativo", true).order("sku"),
      supabase.from("solicitacoes_producao").select("id, data_entrega, status, created_at, observacao_geral, prioridade_producao, periodo_inicio, periodo_fim").order("created_at", { ascending: false }),
      supabase.from("itens_solicitacao_producao").select("id, solicitacao_id, produto_id, sku, quantidade_solicitada, tipo_corte, observacao").order("sku"),
    ]);

    if (produtosResp.error || solicitacoesResp.error || itensResp.error) {
      setErrorMessage(produtosResp.error?.message ?? solicitacoesResp.error?.message ?? itensResp.error?.message ?? "Erro ao carregar dados.");
      setLoading(false);
      return [];
    }

    const produtosCarregados = (produtosResp.data as Produto[]) ?? [];
    setProdutos(produtosCarregados);
    setSolicitacoes([...((solicitacoesResp.data as Solicitacao[]) ?? [])].sort(ordenarSolicitacoes));
    setItens((itensResp.data as ItemSolicitacao[]) ?? []);
    setLoading(false);
    return produtosCarregados;
  }

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (produtos.length === 0) return;

    const raw = window.localStorage.getItem(DASHBOARD_SOLICITACAO_KEY);

    if (!raw) return;

    try {
      const itensDashboard = JSON.parse(raw) as ItemDashboardPendente[];
      const produtosIds = new Set(produtos.map((produto) => produto.id));
      const itensValidos = itensDashboard.filter((item) => produtosIds.has(item.produto_id));

      if (itensValidos.length > 0) {
        setItensForm(
          itensValidos.map((item) => ({
            produto_id: item.produto_id,
            produto_busca: item.sku,
            quantidade_solicitada: String(arredondarParaPar(Number(item.quantidade_solicitada))),
            corte_laser: true,
            observacao: item.observacao ?? "Gerado pelo dashboard",
          })),
        );
        setObservacaoGeral("Gerada a partir do dashboard: vendidos com baixo estoque.");
        setDataEntrega((dataAtual) => dataAtual || formatarDataLocal(new Date()));
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setErrorMessage("Nao foi possivel carregar os itens enviados pelo dashboard.");
    } finally {
      window.localStorage.removeItem(DASHBOARD_SOLICITACAO_KEY);
    }
  }, [produtos]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setAgoraOlist(new Date()), 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  function alterarItem(index: number, patch: Partial<ItemForm>) {
    setItensForm((anterior) => anterior.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function produtosFiltrados(busca: string) {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? produtos.filter((produto) => produto.sku.toLowerCase().includes(termo))
      : produtos;

    return lista.slice(0, 12);
  }

  function alterarProdutoBusca(index: number, valor: string) {
    const produto = produtos.find(
      (item) => item.sku.toLowerCase() === valor.trim().toLowerCase(),
    );

    alterarItem(index, {
      produto_busca: valor,
      produto_id: produto?.id ?? "",
    });
    setProdutoBuscaAberta(index);
  }

  function selecionarProduto(index: number, produto: Produto) {
    alterarItem(index, {
      produto_id: produto.id,
      produto_busca: produto.sku,
    });
    setProdutoBuscaAberta(null);
  }

  function normalizarQuantidadeItem(index: number) {
    setItensForm((anterior) =>
      anterior.map((item, i) =>
        i === index
          ? {
              ...item,
              quantidade_solicitada: normalizarQuantidadePar(item.quantidade_solicitada),
            }
          : item,
      ),
    );
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

  function limparFormulario() {
    setDataEntrega("");
    setObservacaoGeral("");
    setItensForm([{ ...ITEM_INICIAL }]);
    setProcessamentoOlistPendente(null);
    setPrioridadeProducao(false);
    setSolicitacaoEditandoId(null);
  }

  function editarSolicitacao(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    if (itensSolicitacao.length === 0) {
      setErrorMessage("Solicitacao sem itens para editar.");
      return;
    }

    setSolicitacaoEditandoId(solicitacao.id);
    setDataEntrega(solicitacao.data_entrega);
    setObservacaoGeral(solicitacao.observacao_geral ?? "");
    setPrioridadeProducao(Boolean(solicitacao.prioridade_producao));
    setProcessamentoOlistPendente(null);
    setResumoImportacaoOlist(null);
    setErrorMessage(null);
    setItensForm(
      itensSolicitacao.map((item) => ({
        id: item.id,
        produto_id: item.produto_id,
        produto_busca: item.sku,
        quantidade_solicitada: String(arredondarParaPar(Number(item.quantidade_solicitada))),
        corte_laser: item.tipo_corte === "LASER",
        observacao: item.observacao ?? "",
      })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function cancelarSolicitacao(solicitacao: Solicitacao) {
    const confirmar = window.confirm("Cancelar esta solicitação de produção?");

    if (!confirmar) return;

    setSaving(true);
    setErrorMessage(null);

    const { error: solicitacaoErro } = await supabase
      .from("solicitacoes_producao")
      .update({ status: "cancelada" })
      .eq("id", solicitacao.id);

    if (solicitacaoErro) {
      setErrorMessage(`Erro ao cancelar solicitação: ${solicitacaoErro.message}`);
      setSaving(false);
      return;
    }

    const { error: itensErro } = await supabase
      .from("itens_solicitacao_producao")
      .update({ status_item: "cancelada" })
      .eq("solicitacao_id", solicitacao.id);

    if (itensErro) {
      setErrorMessage(`Solicitação cancelada, mas erro ao cancelar itens: ${itensErro.message}`);
      setSaving(false);
      return;
    }

    if (solicitacaoEditandoId === solicitacao.id) {
      limparFormulario();
    }

    await carregarDados();
    setSaving(false);
  }

  function montarHtmlSolicitacao(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    const linhas = itensSolicitacao
      .map(
        (item) => `
          <tr>
            <td class="qtd">${item.quantidade_solicitada}</td>
            <td>${escapeHtml(item.sku)}</td>
            <td>${item.tipo_corte === "LASER" ? "Sim" : "Nao"}</td>
            <td>${escapeHtml(item.observacao || "-")}</td>
          </tr>
        `,
      )
      .join("");

    return `
      <!doctype html>
      <html>
        <head>
          <title>Solicitacao de producao</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
            h1 { font-size: 24px; margin: 0 0 16px; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin-bottom: 20px; font-size: 14px; }
            .prioridade { display: inline-block; background: #dc2626; color: white; font-weight: 900; letter-spacing: .08em; padding: 6px 12px; border-radius: 6px; margin-bottom: 16px; }
            table { border-collapse: collapse; width: 100%; font-size: 13px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
            th { color: #475569; background: #f8fafc; }
            .qtd { text-align: right; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>Solicitacao de producao</h1>
          ${solicitacao.prioridade_producao ? '<div class="prioridade">PRIORIDADE</div>' : ""}
          <div class="meta">
            <div><strong>Data de entrega:</strong> ${formatarDataEntrega(solicitacao.data_entrega)}</div>
            <div><strong>Status:</strong> ${formatarStatus(solicitacao.status)}</div>
            <div><strong>Criada em:</strong> ${new Date(solicitacao.created_at).toLocaleString("pt-BR")}</div>
            <div><strong>Itens:</strong> ${itensSolicitacao.length}</div>
            <div style="grid-column: 1 / -1;"><strong>Observacao geral:</strong> ${escapeHtml(solicitacao.observacao_geral || "-")}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th class="qtd">Quantidade</th>
                <th>SKU</th>
                <th>Corte a laser</th>
                <th>Observacao</th>
              </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  function imprimirSolicitacao(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    const janela = window.open("", "_blank", "noopener,noreferrer");

    if (!janela) {
      setErrorMessage("Nao foi possivel abrir a janela de impressao.");
      return;
    }

    janela.document.write(montarHtmlSolicitacao(solicitacao, itensSolicitacao));
    janela.document.close();
    janela.focus();
    janela.print();
  }

  function baixarImagemSolicitacao(solicitacao: Solicitacao, itensSolicitacao: ItemSolicitacao[]) {
    const largura = 1200;
    const altura = 280 + itensSolicitacao.length * 42;
    const linhas = itensSolicitacao
      .map((item, index) => {
        const y = 235 + index * 42;

        return `
          <text x="80" y="${y}" font-size="18" font-weight="700" text-anchor="end">${item.quantidade_solicitada}</text>
          <text x="130" y="${y}" font-size="18" font-weight="700">${escapeHtml(item.sku)}</text>
          <text x="430" y="${y}" font-size="18">${item.tipo_corte === "LASER" ? "Sim" : "Nao"}</text>
          <text x="600" y="${y}" font-size="18">${escapeHtml(item.observacao || "-").slice(0, 54)}</text>
          <line x1="40" y1="${y + 14}" x2="1160" y2="${y + 14}" stroke="#e2e8f0" />
        `;
      })
      .join("");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <text x="40" y="52" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#0f172a">Solicitacao de producao</text>
        ${
          solicitacao.prioridade_producao
            ? '<rect x="40" y="74" width="170" height="36" rx="6" fill="#dc2626"/><text x="125" y="98" font-family="Arial, sans-serif" font-size="18" font-weight="900" text-anchor="middle" fill="#ffffff">PRIORIDADE</text>'
            : ""
        }
        <text x="40" y="135" font-family="Arial, sans-serif" font-size="18" fill="#334155">Entrega: ${formatarDataEntrega(solicitacao.data_entrega)}</text>
        <text x="300" y="135" font-family="Arial, sans-serif" font-size="18" fill="#334155">Status: ${formatarStatus(solicitacao.status)}</text>
        <text x="560" y="135" font-family="Arial, sans-serif" font-size="18" fill="#334155">Criada em: ${new Date(solicitacao.created_at).toLocaleString("pt-BR")}</text>
        <text x="40" y="168" font-family="Arial, sans-serif" font-size="18" fill="#334155">Observacao geral: ${escapeHtml(solicitacao.observacao_geral || "-").slice(0, 90)}</text>
        <line x1="40" y1="195" x2="1160" y2="195" stroke="#cbd5e1"/>
        <text x="80" y="220" font-family="Arial, sans-serif" font-size="16" font-weight="700" text-anchor="end" fill="#475569">Qtd</text>
        <text x="130" y="220" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#475569">SKU</text>
        <text x="430" y="220" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#475569">Laser</text>
        <text x="600" y="220" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#475569">Observacao</text>
        <g font-family="Arial, sans-serif" fill="#0f172a">${linhas}</g>
      </svg>
    `;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `solicitacao-${solicitacao.id}.svg`;
    link.click();
    URL.revokeObjectURL(url);
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
    setProcessamentoOlistPendente(null);
    setPrioridadeProducao(false);
    const resp = await axios.post(
      "/api/olist/gerar-solicitacao",
      {
        data_limite: formatarDataLocal(periodoAtual.periodo_fim),
        filtro_data_base: FILTRO_DATA_BASE_OLIST,
        periodo_inicio: periodoAtual.periodo_inicio.toISOString(),
        periodo_fim: periodoAtual.periodo_fim.toISOString(),
        situacoes: situacoesOlistSelecionadas,
      },
      {
        validateStatus: () => true,
      },
    );
    const json = resp.data;
    if (resp.status < 200 || resp.status >= 300) {
      const estoqueSuficiente = (Array.isArray(json.estoque_suficiente) ? json.estoque_suficiente : []) as ItemEstoqueSuficiente[];
      const detalhesEstoque = estoqueSuficiente
        .map(
          (item) =>
            `${item.sku}: já tem ${item.estoque_atual} em estoque; pedidos usam ${item.quantidade_pedidos} e ficam ${item.estoque_apos_pedidos} em estoque.`,
        )
        .join(" ");

      setErrorMessage(
        detalhesEstoque
          ? `${json.error ?? "Não há necessidade de produção."} ${detalhesEstoque}`
          : `Erro integração Olist: ${json.error ?? "desconhecido"}`,
      );
      setIntegrandoOlist(false);
      return;
    }
    const itensPreparados = (Array.isArray(json.itens) ? json.itens : []) as ItemPreparadoOlist[];

    if (itensPreparados.length === 0) {
      setErrorMessage("A Olist retornou pedidos, mas nenhum item foi preparado para producao.");
      setIntegrandoOlist(false);
      return;
    }

    await carregarDados();
    setDataEntrega(String(json.data_entrega ?? formatarDataLocal(periodoAtual.periodo_fim)));
    setObservacaoGeral(String(json.observacao_geral ?? "Gerada via Olist. Revise os itens antes de salvar."));
    setPrioridadeProducao(Boolean(json.prioridade_producao));
    setItensForm(
      itensPreparados.map((item) => ({
        produto_id: item.produto_id,
        produto_busca: produtos.find((produto) => produto.id === item.produto_id)?.sku ?? "",
        quantidade_solicitada: String(arredondarParaPar(Number(item.quantidade_solicitada))),
        corte_laser: true,
        observacao: "Gerado por integracao Olist",
        prioridade_producao: Boolean(item.prioridade_producao),
        existe_em_producao: Boolean(item.existe_em_producao),
        quantidade_em_producao: Number(item.quantidade_em_producao ?? 0),
      })),
    );
    setProcessamentoOlistPendente({
      periodo_inicio: String(json.periodo_inicio ?? periodoAtual.periodo_inicio.toISOString()),
      periodo_fim: String(json.periodo_fim ?? periodoAtual.periodo_fim.toISOString()),
      itens: (Array.isArray(json.rastreio_olist) ? json.rastreio_olist : []) as RastreioOlist[],
    });
    setResumoImportacaoOlist({
      pedidos_encontrados: Number(json.pedidos_encontrados ?? 0),
      pedidos_adicionados: Number(json.pedidos_adicionados ?? 0),
      pedidos_ignorados: Number(json.pedidos_ignorados ?? 0),
      total_itens: Number(json.total_itens ?? itensPreparados.length),
      produtos_cadastrados: Number(json.produtos_cadastrados ?? 0),
      motivo_pedidos_ignorados: String(json.motivo_pedidos_ignorados ?? "Pedido já processado anteriormente."),
    });
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
      quantidade: arredondarParaPar(Number(item.quantidade_solicitada)),
    }));

    const itemInvalido = itensNormalizados.find((item) => !item.produto_id || Number.isNaN(item.quantidade) || item.quantidade < 0);

    if (itemInvalido) {
      setErrorMessage("Preencha produto e quantidade válida para todos os itens.");
      setSaving(false);
      return;
    }

    if (solicitacaoEditandoId) {
      const { error: solicitacaoErro } = await supabase
        .from("solicitacoes_producao")
        .update({
          data_entrega: dataEntrega,
          observacao_geral: observacaoGeral.trim() || null,
          prioridade_producao: prioridadeProducao,
        })
        .eq("id", solicitacaoEditandoId);

      if (solicitacaoErro) {
        setErrorMessage(`Erro ao atualizar solicitacao: ${solicitacaoErro.message}`);
        setSaving(false);
        return;
      }

      const idsMantidos = itensNormalizados
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id));

      const deleteQuery = supabase
        .from("itens_solicitacao_producao")
        .delete()
        .eq("solicitacao_id", solicitacaoEditandoId);

      const { error: deleteErro } =
        idsMantidos.length > 0
          ? await deleteQuery.not("id", "in", `(${idsMantidos.join(",")})`)
          : await deleteQuery;

      if (deleteErro) {
        setErrorMessage(`Solicitacao atualizada, mas erro ao remover itens excluidos: ${deleteErro.message}`);
        setSaving(false);
        return;
      }

      for (const item of itensNormalizados) {
        const produto = produtos.find((p) => p.id === item.produto_id);
        const itemPayload = {
          produto_id: item.produto_id,
          sku: produto?.sku ?? "",
          imagem_url: produto?.imagem_url ?? null,
          quantidade_solicitada: item.quantidade,
          tipo_corte: item.corte_laser ? "LASER" : "PADRAO",
          observacao: item.observacao.trim() || null,
        };

        const { error: itemErro } = item.id
          ? await supabase.from("itens_solicitacao_producao").update(itemPayload).eq("id", item.id)
          : await supabase.from("itens_solicitacao_producao").insert({
              ...itemPayload,
              solicitacao_id: solicitacaoEditandoId,
              quantidade_produzida: 0,
              status_item: "em_producao",
            });

        if (itemErro) {
          setErrorMessage(`Solicitacao atualizada, mas erro ao salvar item ${produto?.sku ?? item.produto_busca}: ${itemErro.message}`);
          setSaving(false);
          return;
        }
      }

      limparFormulario();
      await carregarDados();
      setSaving(false);
      return;
    }

    const processamentoOlist = processamentoOlistPendente;
    const prioridadesEncontradas = new Set(itensNormalizados.map((item) => Boolean(item.prioridade_producao)));
    const deveSepararPrioridade = Boolean(processamentoOlist) && prioridadesEncontradas.size > 1;
    const gruposSolicitacao = deveSepararPrioridade
      ? [
          { prioridade: true, itens: itensNormalizados.filter((item) => Boolean(item.prioridade_producao)) },
          { prioridade: false, itens: itensNormalizados.filter((item) => !Boolean(item.prioridade_producao)) },
        ].filter((grupo) => grupo.itens.length > 0)
      : [{ prioridade: prioridadeProducao, itens: itensNormalizados }];

    for (const grupo of gruposSolicitacao) {
      const { data: solicitacaoCriada, error: solicitacaoErro } = await supabase
        .from("solicitacoes_producao")
        .insert({
          data_entrega: dataEntrega,
          status: "em_producao",
          observacao_geral: observacaoGeral.trim() || null,
          prioridade_producao: grupo.prioridade,
          filtro_data_base: processamentoOlist ? FILTRO_DATA_BASE_OLIST : null,
          periodo_inicio: processamentoOlist?.periodo_inicio ?? null,
          periodo_fim: processamentoOlist?.periodo_fim ?? null,
        })
        .select("id")
        .single();

      if (solicitacaoErro || !solicitacaoCriada) {
        setErrorMessage(`Erro ao criar solicitacao: ${solicitacaoErro?.message ?? "erro desconhecido"}`);
        setSaving(false);
        return;
      }

      const itensPayload = grupo.itens.map((item) => {
        const produto = produtos.find((p) => p.id === item.produto_id);
        return {
          solicitacao_id: solicitacaoCriada.id,
          produto_id: item.produto_id,
          sku: produto?.sku ?? "",
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
        setErrorMessage(`Solicitacao criada, mas erro ao criar itens: ${itensErro.message}`);
        setSaving(false);
        return;
      }

      const skusSalvos = new Set(itensPayload.map((item) => item.sku));
      const itensOlistSalvos =
        processamentoOlist?.itens.filter((item) => skusSalvos.has(item.sku)) ?? [];

      if (processamentoOlist && itensOlistSalvos.length) {
        const registroResp = await axios.post(
          "/api/olist/registrar-processados",
          {
            solicitacao_id: solicitacaoCriada.id,
            periodo_inicio: processamentoOlist.periodo_inicio,
            periodo_fim: processamentoOlist.periodo_fim,
            itens: itensOlistSalvos,
          },
          { validateStatus: () => true },
        );

        if (registroResp.status < 200 || registroResp.status >= 300) {
          setErrorMessage(`Solicitacao criada, mas erro ao registrar pedidos Olist: ${registroResp.data?.error ?? "erro desconhecido"}`);
          setSaving(false);
          return;
        }
      }
    }
    limparFormulario();
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
              <p><strong>Itens preenchidos:</strong> {resumoImportacaoOlist.total_itens}</p>
              <p><strong>Produtos cadastrados:</strong> {resumoImportacaoOlist.produtos_cadastrados}</p>
              <p><strong>Pedidos ignorados:</strong> {resumoImportacaoOlist.pedidos_ignorados}</p>
              {resumoImportacaoOlist.pedidos_ignorados > 0 && (
                <p className="mt-1 text-slate-600">Motivo: {resumoImportacaoOlist.motivo_pedidos_ignorados}</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {solicitacaoEditandoId ? "Editar solicitação" : "Nova solicitação manual"}
        </h3>

        <form className="space-y-4" onSubmit={handleSalvar}>
          {prioridadeProducao && (
            <div className="rounded-md border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-black uppercase tracking-wide text-red-700">
              PRIORIDADE
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={prioridadeProducao}
              onChange={(event) => setPrioridadeProducao(event.target.checked)}
            />
            Marcar solicitação como PRIORIDADE
          </label>

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
                {item.prioridade_producao && (
                  <div className="md:col-span-5">
                    <span className="inline-flex rounded bg-red-600 px-2 py-1 text-xs font-black uppercase tracking-wide text-white">
                      PRIORIDADE
                    </span>
                  </div>
                )}
                {item.existe_em_producao && (
                  <div className="md:col-span-5">
                    <span className="inline-flex rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                      ATENÇÃO: existe item em produção
                      {item.quantidade_em_producao ? ` (${item.quantidade_em_producao} solicitado)` : ""}
                    </span>
                  </div>
                )}
                <label className="relative text-sm text-slate-700 md:col-span-2">
                  Produto
                  <input
                    required
                    value={item.produto_busca}
                    onChange={(event) => alterarProdutoBusca(index, event.target.value)}
                    onFocus={() => setProdutoBuscaAberta(index)}
                    onBlur={() => {
                      window.setTimeout(() => setProdutoBuscaAberta(null), 120);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="Digite o SKU para pesquisar"
                  />
                  {produtoBuscaAberta === index && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                      {produtosFiltrados(item.produto_busca).length > 0 ? (
                        produtosFiltrados(item.produto_busca).map((produto) => (
                          <button
                            key={produto.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selecionarProduto(index, produto)}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                          >
                            {produto.sku}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-slate-500">
                          Nenhum produto encontrado
                        </div>
                      )}
                    </div>
                  )}
                </label>

                <label className="text-sm text-slate-700">
                  Quantidade
                  <input
                    required
                    type="number"
                    min={0}
                    step={2}
                    value={item.quantidade_solicitada}
                    onChange={(event) => alterarItem(index, { quantidade_solicitada: event.target.value })}
                    onBlur={() => normalizarQuantidadeItem(index)}
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

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : solicitacaoEditandoId ? "Atualizar solicitação" : "Salvar solicitação"}
            </button>
            {solicitacaoEditandoId && (
              <button
                type="button"
                onClick={limparFormulario}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar edição
              </button>
            )}
          </div>
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
                  <th className="p-3">Prioridade</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Observação geral</th>
                  <th className="p-3">Quantidade de itens</th>
                  <th className="p-3">Data de criação</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {solicitacoes.map((solicitacao) => {
                  const aberta = Boolean(solicitacoesAbertas[solicitacao.id]);
                  const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];
                  const podeAlterar = solicitacao.status !== "concluida" && solicitacao.status !== "cancelada";

                  return (
                    <Fragment key={solicitacao.id}>
                      <tr className="border-b border-slate-100">
                        <td className="p-3 text-slate-700">{new Date(`${solicitacao.data_entrega}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                        <td className="p-3">
                          {solicitacao.prioridade_producao ? (
                            <span className="inline-flex rounded-md bg-red-600 px-3 py-1 text-xs font-black uppercase tracking-wide text-white shadow-sm">
                              PRIORIDADE
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-3 font-medium text-slate-700">{solicitacao.status === "em_producao" ? "EM_PRODUCAO" : solicitacao.status.toUpperCase()}</td>
                        <td className="p-3 text-slate-700">{solicitacao.observacao_geral || "-"}</td>
                        <td className="p-3 text-slate-700">{qtdItensPorSolicitacao[solicitacao.id] ?? 0}</td>
                        <td className="p-3 text-slate-700">{new Date(solicitacao.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => imprimirSolicitacao(solicitacao, itensSolicitacao)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={itensSolicitacao.length === 0}
                            title="Imprimir detalhes"
                            aria-label="Imprimir detalhes da solicitação"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => baixarImagemSolicitacao(solicitacao, itensSolicitacao)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={itensSolicitacao.length === 0}
                            title="Salvar imagem"
                            aria-label="Salvar imagem dos detalhes da solicitação"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => editarSolicitacao(solicitacao, itensSolicitacao)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={itensSolicitacao.length === 0 || saving || !podeAlterar}
                            title="Editar solicitação"
                            aria-label="Editar solicitação"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelarSolicitacao(solicitacao)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={saving || !podeAlterar}
                            title="Cancelar solicitação"
                            aria-label="Cancelar solicitação"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
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
                          </div>
                        </td>
                      </tr>
                      {aberta && (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td className="p-3" colSpan={7}>
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                              <table className="min-w-full border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-slate-600">
                                    <th className="px-3 py-2">Quantidade</th>
                                    <th className="px-3 py-2">SKU</th>
                                    <th className="px-3 py-2">Corte a laser</th>
                                    <th className="px-3 py-2">Observação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itensSolicitacao.map((item) => (
                                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                      <td className="px-3 py-2 font-semibold text-slate-900">{item.quantidade_solicitada}</td>
                                      <td className="px-3 py-2 font-medium text-slate-700">{item.sku}</td>
                                      <td className="px-3 py-2 text-slate-700">{item.tipo_corte === "LASER" ? "Sim" : "Não"}</td>
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
  );
}


