"use client";

import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ChevronDown, Download, Pencil, Printer, Send, XCircle } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";
import { criarInfoAdicionalOlist, criarLinhaObservacaoPedidoOlist } from "@/lib/olist-pedido";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
  produto_fornecido?: ProdutoFornecidoInfo | null;
};

type ProdutoFornecidoInfo = {
  id: string;
  nome: string;
  referencia?: string | null;
  quantidade_por_produto: number;
};

type FornecedorEnvio = {
  id: string;
  nome: string;
  vendedor_olist_id: string;
  aplicativo_id: string;
};

type ItemConferenciaFornecedor = ItemSolicitacao & {
  nomeProduto: string;
  produtoFornecido: ProdutoFornecidoInfo | null;
};

type PedidoFornecedorItemEdicao = {
  produto: { id: number; tipo: string };
  quantidade: number;
  valorUnitario: number;
  infoAdicional: string;
};

type PedidoFornecedorEdicao = {
  idContato: number;
  vendedor: { id: number };
  situacao: number;
  data: string;
  observacoes: string;
  itens: PedidoFornecedorItemEdicao[];
};

type DivisaoInfoAdicional = {
  estampa: string;
  variante: string;
  quantidade: string;
  unidade: string;
  laser: string;
  tamanho: string;
  tipo: string;
};

function extrairDivisoesInfoAdicional(info: string): DivisaoInfoAdicional[] {
  return Array.from(info.matchAll(/<ESTAMPA>([\s\S]*?)<\/ESTAMPA>/g)).map((match) => {
    const bloco = match[1];
    const valor = (tag: string) => bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "";
    return {
      estampa: valor("COD"), variante: valor("VAR"), quantidade: valor("QTD"),
      unidade: valor("UN"), laser: valor("LASER") || "false",
      tamanho: valor("TAM"),
      tipo: valor("TIPO"),
    };
  });
}

function montarInfoAdicional(divisoes: DivisaoInfoAdicional[]) {
  return criarInfoAdicionalOlist(divisoes, "MT", { incluirTagsVazias: true });
}

type ProdutoOlistProdutoFornecedorRow = {
  produto_fornecedor_id: string;
  quantidade_usada: number | string | null;
};

type ProdutoFornecedorRow = {
  id: string;
  nome: string;
  referencia: string | null;
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
  produto_fornecido?: ProdutoFornecidoInfo | null;
  quantidade_solicitada: string;
  corte_laser: boolean;
  observacao: string;
  prioridade_producao?: boolean;
  existe_em_producao?: boolean;
  quantidade_em_producao?: number;
  quantidade_pedidos?: number;
  estoque_atual?: number;
};

type ItemPreparadoOlist = {
  produto_id: string;
  quantidade_solicitada: number;
  prioridade_producao?: boolean;
  existe_em_producao?: boolean;
  quantidade_em_producao?: number;
  quantidade_pedidos?: number;
  estoque_atual?: number;
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
const SITUACOES_OLIST_PADRAO = ["1", "3", "4"];
const SITUACOES_OLIST_OPCOES = [
  { value: "8", label: "8 - Dados Incompletos" },
  { value: "0", label: "0 - Aberta" },
  { value: "3", label: "3 - Aprovada" },
  { value: "4", label: "4 - Preparando Envio" },
  { value: "1", label: "1 - Faturada" },
  { value: "7", label: "7 - Pronto Envio" },
  { value: "5", label: "5 - Enviada" },
  { value: "6", label: "6 - Entregue" },
  { value: "2", label: "2 - Cancelada" },
  { value: "9", label: "9 - Nao Entregue" },
];
const DASHBOARD_SOLICITACAO_KEY = "dashboard_solicitacao_manual_itens";
const OBS_PRODUTO_FORNECIDO_PREFIXES = ["Produto fornecido:"];
const OBS_PRODUTO_FORNECIDO_START = "<!--produto-fornecido:start-->";
const OBS_PRODUTO_FORNECIDO_END = "<!--produto-fornecido:end-->";
const OBS_PRODUTO_FORNECIDO_LINHA_REGEX =
  /^\d+(?:[,.]\d+)?\s*m\s+de\s+.+\(\d+\s*x\s*\d+(?:[,.]\d+)?\s*m\)\.$/i;
const LIMITE_SOLICITACOES_RESUMO = 80;

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

function normalizarQuantidadeInteira(valor: string) {
  const quantidade = Number(valor);

  if (Number.isNaN(quantidade) || quantidade < 0) return "0";

  return String(Math.ceil(quantidade));
}

function quantidadeMinimaProducao(item: Pick<ItemForm, "quantidade_pedidos">) {
  return Math.max(0, Math.ceil(Number(item.quantidade_pedidos ?? 0)));
}

function normalizarQuantidadeProducao(item: ItemForm) {
  const quantidadeNormalizada = Number(normalizarQuantidadeInteira(item.quantidade_solicitada));
  const quantidadeMinima = quantidadeMinimaProducao(item);

  return String(Math.max(quantidadeNormalizada, quantidadeMinima));
}

function numeroDecimal(valor: number | string | null | undefined) {
  if (valor === null || valor === undefined || valor === "") return null;

  const numero = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isNaN(numero) ? null : numero;
}

function formatarDecimal(valor: number, casas = 4) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  }).format(valor);
}

function removerObservacaoProdutoFornecido(observacao: string) {
  const semBlocosMarcados = observacao.replace(
    new RegExp(`${OBS_PRODUTO_FORNECIDO_START}[\\s\\S]*?${OBS_PRODUTO_FORNECIDO_END}`, "g"),
    "",
  );

  return semBlocosMarcados
    .split(/\r?\n/)
    .filter(
      (linha) => {
        const linhaNormalizada = linha.trim();

        return (
          !OBS_PRODUTO_FORNECIDO_PREFIXES.some((prefixo) => linhaNormalizada.startsWith(prefixo)) &&
          !OBS_PRODUTO_FORNECIDO_LINHA_REGEX.test(linhaNormalizada)
        );
      },
    )
    .join("\n")
    .trim();
}

function ocultarMarcadoresObservacaoProdutoFornecido(observacao: string) {
  return observacao
    .replaceAll(OBS_PRODUTO_FORNECIDO_START, "")
    .replaceAll(OBS_PRODUTO_FORNECIDO_END, "")
    .trim();
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
  const { session, usuario } = useAuth();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [itensPorSolicitacao, setItensPorSolicitacao] = useState<Record<string, ItemSolicitacao[]>>({});
  const [itensCarregando, setItensCarregando] = useState<Record<string, boolean>>({});
  const [pedidosOlistPorSolicitacao, setPedidosOlistPorSolicitacao] = useState<Record<string, string[]>>({});
  const [dataEntrega, setDataEntrega] = useState("");
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [itensForm, setItensForm] = useState<ItemForm[]>([{ ...ITEM_INICIAL }]);
  const [produtoBuscaAberta, setProdutoBuscaAberta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solicitacoesAbertas, setSolicitacoesAbertas] = useState<Record<string, boolean>>({});
  const [solicitacaoEditandoId, setSolicitacaoEditandoId] = useState<string | null>(null);
  const [envioModalOpen, setEnvioModalOpen] = useState(false);
  const [envioEtapa, setEnvioEtapa] = useState<1 | 2 | 3>(1);
  const [envioSolicitacao, setEnvioSolicitacao] = useState<Solicitacao | null>(null);
  const [fornecedoresEnvio, setFornecedoresEnvio] = useState<FornecedorEnvio[]>([]);
  const [fornecedorEnvioId, setFornecedorEnvioId] = useState("");
  const [itensConferencia, setItensConferencia] = useState<ItemConferenciaFornecedor[]>([]);
  const [envioCarregando, setEnvioCarregando] = useState(false);
  const [envioEnviando, setEnvioEnviando] = useState(false);
  const [envioErro, setEnvioErro] = useState<string | null>(null);
  const [envioSucesso, setEnvioSucesso] = useState<{ id?: number; numeroPedido?: string } | null>(null);
  const [pedidoFornecedorEdicao, setPedidoFornecedorEdicao] = useState<PedidoFornecedorEdicao | null>(null);

  const [situacoesOlistSelecionadas, setSituacoesOlistSelecionadas] = useState<string[]>(SITUACOES_OLIST_PADRAO);
  const [integrandoOlist, setIntegrandoOlist] = useState(false);
  const [resumoImportacaoOlist, setResumoImportacaoOlist] = useState<ResultadoImportacaoOlist | null>(null);
  const [processamentoOlistPendente, setProcessamentoOlistPendente] = useState<ProcessamentoOlistPendente | null>(null);
  const [prioridadeProducao, setPrioridadeProducao] = useState(false);
  const podeSolicitarProducao = Boolean(usuario?.podeSolicitarProducao);

  const carregarDados = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const [solicitacoesProducaoResp, demaisSolicitacoesResp, produtosResponse, pedidosResponse] = await Promise.all([
        supabase
          .from("solicitacoes_producao")
          .select("id, data_entrega, status, created_at, observacao_geral, prioridade_producao, periodo_inicio, periodo_fim")
          .eq("status", "em_producao")
          .order("prioridade_producao", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(LIMITE_SOLICITACOES_RESUMO),
        supabase
          .from("solicitacoes_producao")
          .select("id, data_entrega, status, created_at, observacao_geral, prioridade_producao, periodo_inicio, periodo_fim")
          .neq("status", "em_producao")
          .order("created_at", { ascending: false })
          .limit(LIMITE_SOLICITACOES_RESUMO),
        fetch("/api/produtos/opcoes", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch("/api/solicitacoes-producao/pedidos-fornecedor", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);

      if (solicitacoesProducaoResp.error || demaisSolicitacoesResp.error) {
        setErrorMessage(
          solicitacoesProducaoResp.error?.message ??
            demaisSolicitacoesResp.error?.message ??
            "Erro ao carregar dados.",
        );
        return [];
      }

      const solicitacoesCarregadas = [
        ...((solicitacoesProducaoResp.data as Solicitacao[]) ?? []),
        ...((demaisSolicitacoesResp.data as Solicitacao[]) ?? []),
      ];

      setSolicitacoes(solicitacoesCarregadas.sort(ordenarSolicitacoes));
      setItensPorSolicitacao({});
      setItensCarregando({});
      const produtosJson = await produtosResponse.json() as { produtos?: Produto[]; error?: string };
      const pedidosJson = await pedidosResponse.json() as {
        pedidos?: Array<{ solicitacaoId: string; pedidoOlistId: string }>;
        error?: string;
      };
      if (!produtosResponse.ok) {
        setErrorMessage(`Solicitações carregadas, mas erro ao carregar produtos: ${produtosJson.error ?? "erro desconhecido"}`);
        return [];
      }
      if (!pedidosResponse.ok) {
        setErrorMessage(`Solicitações carregadas, mas erro ao carregar pedidos: ${pedidosJson.error ?? "erro desconhecido"}`);
        return [];
      }

      const produtosCarregados = produtosJson.produtos ?? [];
      setProdutos(produtosCarregados);
      const pedidosAgrupados: Record<string, string[]> = {};
      for (const pedido of pedidosJson.pedidos ?? []) {
        pedidosAgrupados[pedido.solicitacaoId] ??= [];
        pedidosAgrupados[pedido.solicitacaoId].push(pedido.pedidoOlistId);
      }
      setPedidosOlistPorSolicitacao(pedidosAgrupados);
      return produtosCarregados;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar dados.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  async function carregarItensSolicitacao(solicitacaoId: string, force = false) {
    if (!force && itensPorSolicitacao[solicitacaoId]) {
      return itensPorSolicitacao[solicitacaoId];
    }

    setItensCarregando((anterior) => ({ ...anterior, [solicitacaoId]: true }));
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("itens_solicitacao_producao")
      .select("id, solicitacao_id, produto_id, sku, quantidade_solicitada, tipo_corte, observacao")
      .eq("solicitacao_id", solicitacaoId)
      .order("sku");

    setItensCarregando((anterior) => ({ ...anterior, [solicitacaoId]: false }));

    if (error) {
      setErrorMessage(`Erro ao carregar itens da solicitacao: ${error.message}`);
      return null;
    }

    const itensCarregados = (data as ItemSolicitacao[]) ?? [];
    setItensPorSolicitacao((anterior) => ({ ...anterior, [solicitacaoId]: itensCarregados }));

    return itensCarregados;
  }

  async function carregarProdutoFornecido(produtoId: string, produtosBase = produtos) {
    const produtoEmCache = produtosBase.find((produto) => produto.id === produtoId);

    if (!produtoEmCache) return null;
    if (produtoEmCache.produto_fornecido !== undefined) {
      return produtoEmCache.produto_fornecido;
    }

    const salvarCache = (produtoFornecido: ProdutoFornecidoInfo | null) => {
      setProdutos((anteriores) =>
        anteriores.map((produto) =>
          produto.id === produtoId ? { ...produto, produto_fornecido: produtoFornecido } : produto,
        ),
      );

      return produtoFornecido;
    };

    const { data: associacoesData, error: associacoesError } = await supabase
      .from("produto_olist_produto_fornecedor")
      .select("produto_fornecedor_id, quantidade_usada")
      .eq("produto_id", produtoId)
      .limit(1);

    if (associacoesError) {
      setErrorMessage(`Erro ao validar produto fornecido: ${associacoesError.message}`);
      return null;
    }

    const associacao = ((associacoesData as ProdutoOlistProdutoFornecedorRow[]) ?? [])[0];

    if (!associacao) return salvarCache(null);

    const { data: fornecedorData, error: fornecedorError } = await supabase
      .from("produtos_fornecedor")
      .select("id, nome, referencia")
      .eq("id", associacao.produto_fornecedor_id)
      .maybeSingle();

    if (fornecedorError) {
      setErrorMessage(`Erro ao validar produto fornecido: ${fornecedorError.message}`);
      return null;
    }

    const fornecedor = fornecedorData as ProdutoFornecedorRow | null;
    const quantidadePorProduto = numeroDecimal(associacao.quantidade_usada);

    if (!fornecedor || quantidadePorProduto === null || quantidadePorProduto <= 0) {
      return salvarCache(null);
    }

    return salvarCache({
      id: fornecedor.id,
      nome: fornecedor.nome,
      referencia: fornecedor.referencia,
      quantidade_por_produto: quantidadePorProduto,
    });
  }

  function fecharEnvioFornecedor() {
    setEnvioModalOpen(false);
    setEnvioEtapa(1);
    setEnvioSolicitacao(null);
    setFornecedoresEnvio([]);
    setFornecedorEnvioId("");
    setItensConferencia([]);
    setEnvioErro(null);
    setEnvioSucesso(null);
    setPedidoFornecedorEdicao(null);
  }

  async function abrirEnvioFornecedor(solicitacao: Solicitacao) {
    if (!session) return;
    setEnvioModalOpen(true);
    setEnvioEtapa(1);
    setEnvioSolicitacao(solicitacao);
    setFornecedorEnvioId("");
    setItensConferencia([]);
    setEnvioErro(null);
    setEnvioSucesso(null);
    setPedidoFornecedorEdicao(null);
    setEnvioCarregando(true);

    const { data, error } = await supabase
      .from("fornecedores")
      .select("id, nome, vendedor_olist_id, aplicativo_id")
      .not("vendedor_olist_id", "is", null)
      .not("aplicativo_id", "is", null)
      .order("nome");

    if (error) setEnvioErro(`Erro ao carregar fornecedores: ${error.message}`);
    else setFornecedoresEnvio((data as FornecedorEnvio[]) ?? []);
    setEnvioCarregando(false);
  }

  async function revisarProdutosFornecedor() {
    if (!envioSolicitacao || !fornecedorEnvioId) return;
    setEnvioCarregando(true);
    setEnvioErro(null);

    try {
      const itens = await carregarItensSolicitacao(envioSolicitacao.id);
      if (!itens?.length) throw new Error("A solicitação não possui produtos para conferência.");

      const detalhes = await Promise.all(itens.map(async (item) => {
        const [{ data: produtoOlistData }, produtoFornecido] = await Promise.all([
          supabase
            .from("produto_olist")
            .select("titulo_final")
            .eq("produto_id", item.produto_id)
            .limit(1)
            .maybeSingle(),
          carregarProdutoFornecido(item.produto_id),
        ]);

        return {
          ...item,
          nomeProduto: (produtoOlistData as { titulo_final?: string } | null)?.titulo_final ?? item.sku,
          produtoFornecido,
        };
      }));

      setItensConferencia(detalhes);
      setEnvioEtapa(2);
    } catch (error) {
      setEnvioErro(error instanceof Error ? error.message : "Erro ao preparar conferência dos produtos.");
    } finally {
      setEnvioCarregando(false);
    }
  }

  async function confirmarEnvioFornecedor() {
    if (!session?.access_token || !envioSolicitacao || !fornecedorEnvioId) return;
    setEnvioEnviando(true);
    setEnvioErro(null);
    try {
      if (!pedidoFornecedorEdicao) throw new Error("A prévia do pedido não foi carregada.");
      const response = await fetch("/api/fornecedores/enviar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fornecedorId: fornecedorEnvioId,
          solicitacaoId: envioSolicitacao.id,
          acao: "enviar",
          pedidoEditado: pedidoFornecedorEdicao,
        }),
      });
      const json = await response.json() as { id?: number; numeroPedido?: string; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível criar o pedido na Olist.");
      setEnvioSucesso(json);
    } catch (error) {
      setEnvioErro(error instanceof Error ? error.message : "Erro ao enviar para o fornecedor.");
    } finally {
      setEnvioEnviando(false);
    }
  }

  async function prepararPedidoFornecedor() {
    if (!session?.access_token || !envioSolicitacao || !fornecedorEnvioId) return;
    setEnvioCarregando(true);
    setEnvioErro(null);
    try {
      const response = await fetch("/api/fornecedores/enviar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fornecedorId: fornecedorEnvioId,
          solicitacaoId: envioSolicitacao.id,
          acao: "preview",
        }),
      });
      const json = await response.json() as { pedido?: PedidoFornecedorEdicao; error?: string };
      if (!response.ok || !json.pedido) throw new Error(json.error ?? "Não foi possível gerar a prévia do pedido.");
      setPedidoFornecedorEdicao(json.pedido);
      setEnvioEtapa(3);
    } catch (error) {
      setEnvioErro(error instanceof Error ? error.message : "Erro ao preparar o pedido.");
    } finally {
      setEnvioCarregando(false);
    }
  }

  function alterarPedidoFornecedor(patch: Partial<PedidoFornecedorEdicao>) {
    setPedidoFornecedorEdicao((pedido) => pedido ? { ...pedido, ...patch } : pedido);
  }

  function alterarItemPedidoFornecedor(index: number, patch: Partial<PedidoFornecedorItemEdicao>) {
    setPedidoFornecedorEdicao((pedido) => pedido ? {
      ...pedido,
      itens: pedido.itens.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    } : pedido);
  }

  function alterarDivisaoPedidoFornecedor(
    itemIndex: number,
    divisaoIndex: number,
    campo: keyof DivisaoInfoAdicional,
    valor: string,
  ) {
    setPedidoFornecedorEdicao((pedido) => {
      if (!pedido?.itens[itemIndex]) return pedido;
      const divisoes = extrairDivisoesInfoAdicional(pedido.itens[itemIndex].infoAdicional);
      if (!divisoes[divisaoIndex]) return pedido;
      divisoes[divisaoIndex] = { ...divisoes[divisaoIndex], [campo]: valor };

      const indiceObservacao = pedido.itens
        .slice(0, itemIndex)
        .reduce((total, item) => total + extrairDivisoesInfoAdicional(item.infoAdicional).length, 0) + divisaoIndex;
      const linhasObservacao = pedido.observacoes.split("\n.\n");
      const partes = linhasObservacao[indiceObservacao]?.split("     |     ") ?? [];
      if (partes.length >= 3) {
        linhasObservacao[indiceObservacao] = criarLinhaObservacaoPedidoOlist({
          descricao: partes[0],
          quantidade: divisoes[divisaoIndex].quantidade,
          unidade: divisoes[divisaoIndex].unidade,
          estampa: divisoes[divisaoIndex].estampa,
          variante: divisoes[divisaoIndex].variante,
          laser: divisoes[divisaoIndex].laser,
          tamanho: divisoes[divisaoIndex].tamanho,
          tipo: divisoes[divisaoIndex].tipo,
        });
      }

      return {
        ...pedido,
        observacoes: linhasObservacao.join("\n.\n"),
        itens: pedido.itens.map((item, index) => index === itemIndex
          ? { ...item, infoAdicional: montarInfoAdicional(divisoes) }
          : item),
      };
    });
  }

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

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
            quantidade_solicitada: normalizarQuantidadeInteira(String(item.quantidade_solicitada)),
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

  function montarObservacaoProdutoFornecido(item: ItemForm) {
    const produto = produtos.find((produtoAtual) => produtoAtual.id === item.produto_id);
    const produtoFornecido = item.produto_fornecido ?? produto?.produto_fornecido;
    const quantidadeSolicitada = Math.ceil(Number(item.quantidade_solicitada));

    if (
      !produtoFornecido ||
      Number.isNaN(quantidadeSolicitada) ||
      quantidadeSolicitada <= 0
    ) {
      return null;
    }

    const quantidadeTotal = quantidadeSolicitada * produtoFornecido.quantidade_por_produto;

    return `${OBS_PRODUTO_FORNECIDO_START}${formatarDecimal(quantidadeTotal)} m de ${produtoFornecido.nome} (${quantidadeSolicitada} x ${formatarDecimal(produtoFornecido.quantidade_por_produto)} m).${OBS_PRODUTO_FORNECIDO_END}`;
  }

  function aplicarObservacaoProdutoFornecido(item: ItemForm) {
    const observacaoManual = removerObservacaoProdutoFornecido(item.observacao);
    const observacaoProdutoFornecido = montarObservacaoProdutoFornecido(item);

    return {
      ...item,
      observacao: [observacaoManual, observacaoProdutoFornecido].filter(Boolean).join("\n"),
    };
  }

  function alterarItem(index: number, patch: Partial<ItemForm>) {
    setItensForm((anterior) =>
      anterior.map((item, i) =>
        i === index ? aplicarObservacaoProdutoFornecido({ ...item, ...patch }) : item,
      ),
    );
  }

  function produtosFiltrados(busca: string) {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? produtos.filter((produto) => produto.sku.toLowerCase().includes(termo))
      : produtos;

    return lista.slice(0, 12);
  }

  async function alterarProdutoBusca(index: number, valor: string) {
    const produto = produtos.find(
      (item) => item.sku.toLowerCase() === valor.trim().toLowerCase(),
    );
    const produtoFornecido = produto ? await carregarProdutoFornecido(produto.id) : null;

    alterarItem(index, {
      produto_busca: valor,
      produto_id: produto?.id ?? "",
      produto_fornecido: produtoFornecido,
    });
    setProdutoBuscaAberta(index);
  }

  async function selecionarProduto(index: number, produto: Produto) {
    const produtoFornecido = await carregarProdutoFornecido(produto.id);

    alterarItem(index, {
      produto_id: produto.id,
      produto_busca: produto.sku,
      produto_fornecido: produtoFornecido,
    });
    setProdutoBuscaAberta(null);
  }

  function alternarSituacaoOlist(situacao: string) {
    setSituacoesOlistSelecionadas((anteriores) =>
      anteriores.includes(situacao)
        ? anteriores.filter((item) => item !== situacao)
        : [...anteriores, situacao],
    );
  }

  function normalizarQuantidadeItem(index: number) {
    setItensForm((anterior) =>
      anterior.map((item, i) =>
        i === index
          ? aplicarObservacaoProdutoFornecido({
              ...item,
              quantidade_solicitada: normalizarQuantidadeProducao(item),
            })
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

  async function alternarDetalhesSolicitacao(solicitacaoId: string) {
    const vaiAbrir = !solicitacoesAbertas[solicitacaoId];

    setSolicitacoesAbertas((anterior) => ({
      ...anterior,
      [solicitacaoId]: vaiAbrir,
    }));

    if (vaiAbrir) {
      await carregarItensSolicitacao(solicitacaoId);
    }
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
    if (!podeSolicitarProducao) return;

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
        quantidade_solicitada: normalizarQuantidadeInteira(String(item.quantidade_solicitada)),
        corte_laser: item.tipo_corte === "LASER",
        observacao: item.observacao ?? "",
      })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function cancelarSolicitacao(solicitacao: Solicitacao) {
    if (!podeSolicitarProducao) return;

    const confirmar = window.confirm(
      solicitacao.status === "concluida"
        ? "Cancelar esta solicitação concluída? A entrada dos produtos será estornada do estoque."
        : "Cancelar esta solicitação de produção?",
    );

    if (!confirmar) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      if (!session?.access_token) throw new Error("Sessão expirada.");
      const response = await fetch("/api/solicitacoes-producao/cancelar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ solicitacaoId: solicitacao.id }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Erro ao cancelar solicitação.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao cancelar solicitação.");
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
    if (!podeSolicitarProducao) return;

    if (situacoesOlistSelecionadas.length === 0) {
      setErrorMessage("Selecione ao menos uma situação para consultar pedidos.");
      return;
    }

    const dataProcessamento = new Date();
    const editandoSolicitacao = Boolean(solicitacaoEditandoId);

    setIntegrandoOlist(true);
    setErrorMessage(null);
    setResumoImportacaoOlist(null);
    setProcessamentoOlistPendente(null);
    if (!editandoSolicitacao) setPrioridadeProducao(false);
    const resp = await axios.post(
      "/api/olist/gerar-solicitacao",
      {
        data_limite: formatarDataLocal(dataProcessamento),
        filtro_data_base: FILTRO_DATA_BASE_OLIST,
        situacoes: situacoesOlistSelecionadas,
      },
      {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
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

    const produtosAtualizados = await carregarDados();
    if (!editandoSolicitacao) {
      setDataEntrega(String(json.data_entrega ?? formatarDataLocal(dataProcessamento)));
      setObservacaoGeral("MV:");
      setPrioridadeProducao(Boolean(json.prioridade_producao));
    }
    const itensComProdutoFornecido = await Promise.all(
      itensPreparados.map(async (item) => {
        const produto = produtosAtualizados.find((produtoAtual) => produtoAtual.id === item.produto_id);
        const produtoFornecido = await carregarProdutoFornecido(item.produto_id, produtosAtualizados);

        return aplicarObservacaoProdutoFornecido({
          produto_id: item.produto_id,
          produto_busca: produto?.sku ?? "",
          produto_fornecido: produtoFornecido,
          quantidade_solicitada: normalizarQuantidadeInteira(String(item.quantidade_solicitada)),
          corte_laser: true,
          observacao: "",
          prioridade_producao: Boolean(item.prioridade_producao),
          existe_em_producao: Boolean(item.existe_em_producao),
          quantidade_em_producao: Number(item.quantidade_em_producao ?? 0),
          quantidade_pedidos: Number(item.quantidade_pedidos ?? 0),
          estoque_atual: Number(item.estoque_atual ?? 0),
        });
      }),
    );
    setItensForm((itensAtuais) =>
      editandoSolicitacao
        ? [...itensAtuais, ...itensComProdutoFornecido]
        : itensComProdutoFornecido,
    );
    setProcessamentoOlistPendente({
      periodo_inicio: String(json.periodo_inicio ?? dataProcessamento.toISOString()),
      periodo_fim: String(json.periodo_fim ?? dataProcessamento.toISOString()),
      itens: (Array.isArray(json.rastreio_olist) ? json.rastreio_olist : []) as RastreioOlist[],
    });
    setResumoImportacaoOlist({
      pedidos_encontrados: Number(json.pedidos_encontrados ?? 0),
      pedidos_adicionados: Number(json.pedidos_adicionados ?? 0),
      pedidos_ignorados: Number(json.pedidos_ignorados ?? 0),
      total_itens: Number(json.total_itens ?? itensPreparados.length),
      produtos_cadastrados: Number(json.produtos_cadastrados ?? 0),
      motivo_pedidos_ignorados: String(json.motivo_pedidos_ignorados ?? "Nenhum pedido é ignorado durante a busca."),
    });
    setIntegrandoOlist(false);
  }

  async function handleSalvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeSolicitarProducao) return;

    setSaving(true);
    setErrorMessage(null);

    if (!dataEntrega) {
      setErrorMessage("Selecione a data de entrega.");
      setSaving(false);
      return;
    }

    const itensNormalizados = itensForm.map((item) => {
      const itemComObservacao = aplicarObservacaoProdutoFornecido(item);

      return {
        ...itemComObservacao,
        quantidade: Math.ceil(Number(itemComObservacao.quantidade_solicitada)),
      };
    });

    const itemInvalido = itensNormalizados.find((item) => !item.produto_id || Number.isNaN(item.quantidade) || item.quantidade < 0);

    if (itemInvalido) {
      setErrorMessage("Preencha produto e quantidade válida para todos os itens.");
      setSaving(false);
      return;
    }

    const itemAbaixoPedido = itensNormalizados.find((item) => item.quantidade < quantidadeMinimaProducao(item));

    if (itemAbaixoPedido) {
      setErrorMessage(`A quantidade de produção de ${itemAbaixoPedido.produto_busca} deve ser pelo menos a quantidade vendida (${quantidadeMinimaProducao(itemAbaixoPedido)}).`);
      setSaving(false);
      return;
    }

    const prioridadeSolicitacao =
      prioridadeProducao || itensNormalizados.some((item) => Boolean(item.prioridade_producao));

    if (solicitacaoEditandoId) {
      const { error: solicitacaoErro } = await supabase
        .from("solicitacoes_producao")
        .update({
          data_entrega: dataEntrega,
          observacao_geral: observacaoGeral.trim() || null,
          prioridade_producao: prioridadeSolicitacao,
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
          observacao: ocultarMarcadoresObservacaoProdutoFornecido(item.observacao).trim() || null,
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
    const gruposSolicitacao = [{ prioridade: prioridadeSolicitacao, itens: itensNormalizados }];

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
          observacao: ocultarMarcadoresObservacaoProdutoFornecido(item.observacao).trim() || null,
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

  const solicitacoesEmProducao = solicitacoes.filter((solicitacao) => solicitacao.status === "em_producao");
  const demaisSolicitacoes = solicitacoes.filter((solicitacao) => solicitacao.status !== "em_producao");

  function renderTabelaSolicitacoes(
    solicitacoesTabela: Solicitacao[],
    destacarDivisao = false,
    exibirPedidoOlist = false,
  ) {
    return (
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
              {exibirPedidoOlist && <th className="p-3">ID pedido Olist</th>}
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {solicitacoesTabela.map((solicitacao) => {
              const aberta = Boolean(solicitacoesAbertas[solicitacao.id]);
              const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];
              const itensJaCarregados = Boolean(itensPorSolicitacao[solicitacao.id]);
              const carregandoItens = Boolean(itensCarregando[solicitacao.id]);
              const podeEditar = solicitacao.status !== "concluida" && solicitacao.status !== "cancelada";
              const podeCancelar = solicitacao.status !== "cancelada";

              return (
                <Fragment key={solicitacao.id}>
                  <tr className={`border-b ${destacarDivisao && !aberta ? "border-b-2 border-slate-200" : "border-slate-100"}`}>
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
                    <td className="p-3 text-slate-700">
                      {itensJaCarregados ? itensSolicitacao.length : "Ao abrir"}
                    </td>
                    <td className="p-3 text-slate-700">{new Date(solicitacao.created_at).toLocaleString("pt-BR")}</td>
                    {exibirPedidoOlist && (
                      <td className="p-3 text-slate-700">
                        {(pedidosOlistPorSolicitacao[solicitacao.id] ?? []).join(", ") || "-"}
                      </td>
                    )}
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const itensCarregados = await carregarItensSolicitacao(solicitacao.id);
                            if (itensCarregados?.length) imprimirSolicitacao(solicitacao, itensCarregados);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={carregandoItens}
                          title="Imprimir detalhes"
                          aria-label="Imprimir detalhes da solicitação"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const itensCarregados = await carregarItensSolicitacao(solicitacao.id);
                            if (itensCarregados?.length) baixarImagemSolicitacao(solicitacao, itensCarregados);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={carregandoItens}
                          title="Salvar imagem"
                          aria-label="Salvar imagem dos detalhes da solicitação"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        {podeSolicitarProducao && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const itensCarregados = await carregarItensSolicitacao(solicitacao.id);
                                if (itensCarregados?.length) editarSolicitacao(solicitacao, itensCarregados);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={carregandoItens || saving || !podeEditar}
                              title="Editar solicitação"
                              aria-label="Editar solicitação"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelarSolicitacao(solicitacao)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={saving || !podeCancelar}
                              title="Cancelar solicitação"
                              aria-label="Cancelar solicitação"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {destacarDivisao && (
                          <button
                            type="button"
                            onClick={() => void abrirEnvioFornecedor(solicitacao)}
                            disabled={!session || carregandoItens || envioCarregando}
                            className="inline-flex items-center gap-2 rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                            title={session ? "Enviar para o fornecedor" : "Entre no sistema para enviar"}
                          >
                            <Send className="h-4 w-4" aria-hidden="true" />
                            Enviar para o Fornecedor
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => alternarDetalhesSolicitacao(solicitacao.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={carregandoItens}
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
                    <tr className={`border-b bg-slate-50 ${destacarDivisao ? "border-b-2 border-slate-200" : "border-slate-100"}`}>
                      <td className="p-3" colSpan={exibirPedidoOlist ? 8 : 7}>
                        {carregandoItens ? (
                          <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
                            Carregando itens da solicitacao...
                          </p>
                        ) : itensSolicitacao.length === 0 ? (
                          <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
                            Solicitacao sem itens cadastrados.
                          </p>
                        ) : (
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
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AccessGuard permissions={["podeSolicitarProducao", "podeVisualizarProducao"]}>
      <div className="space-y-8">
      <PageHeader
        title="Solicitações de Produção"
        description="Crie novas solicitações e acompanhe as solicitações já abertas."
      />

      {errorMessage && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}


      {podeSolicitarProducao && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Gerar solicitação via Olist</h3>
        <div className="flex flex-col gap-3 md:max-w-md">
          <label className="text-sm text-slate-700">
            Tipo de data
            <input readOnly value="Aprovação do pedido" className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600" />
          </label>
          <div className="text-sm text-slate-700">
            <span className="font-medium">Situações consultadas</span>
            <div className="mt-2 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              {SITUACOES_OLIST_OPCOES.map((situacao) => (
                <label key={situacao.value} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
                  <input
                    type="checkbox"
                    checked={situacoesOlistSelecionadas.includes(situacao.value)}
                    onChange={() => alternarSituacaoOlist(situacao.value)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {situacao.label}
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={gerarViaOlist} disabled={integrandoOlist || situacoesOlistSelecionadas.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {integrandoOlist ? "Integrando..." : "Gerar solicitação automaticamente"}
          </button>
          {resumoImportacaoOlist && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <p><strong>Pedidos encontrados:</strong> {resumoImportacaoOlist.pedidos_encontrados}</p>
              <p><strong>Pedidos adicionados:</strong> {resumoImportacaoOlist.pedidos_adicionados}</p>
              <p><strong>Itens preenchidos:</strong> {resumoImportacaoOlist.total_itens}</p>
              <p><strong>Produtos cadastrados:</strong> {resumoImportacaoOlist.produtos_cadastrados}</p>
              {resumoImportacaoOlist.pedidos_ignorados > 0 ? (
                <p className="mt-1 text-slate-600">Motivo: {resumoImportacaoOlist.motivo_pedidos_ignorados}</p>
              ) : (
                <p><strong>Todos os pedidos encontrados foram considerados.</strong></p>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      {podeSolicitarProducao && (
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
                {item.quantidade_pedidos !== undefined && (
                  <div className="md:col-span-5">
                    <span className="inline-flex flex-wrap gap-x-2 gap-y-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
                      <span>Pedidos: {item.quantidade_pedidos}</span>
                      <span>Estoque: {item.estoque_atual ?? 0}</span>
                    </span>
                  </div>
                )}
                {item.existe_em_producao && (
                  <div className="md:col-span-5">
                    <span className="inline-flex flex-wrap gap-x-2 gap-y-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                      <span>ATENÇÃO: existe item em produção</span>
                      <span>Solicitado: {item.quantidade_em_producao ?? 0}</span>
                    </span>
                  </div>
                )}
                <label className="relative text-sm text-slate-700 md:col-span-2">
                  Produto
                  <input
                    required
                    value={item.produto_busca}
                    onChange={(event) => void alterarProdutoBusca(index, event.target.value)}
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
                            onClick={() => void selecionarProduto(index, produto)}
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
                    min={quantidadeMinimaProducao(item)}
                    step={1}
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
                  <textarea
                    value={ocultarMarcadoresObservacaoProdutoFornecido(item.observacao)}
                    onChange={(event) => alterarItem(index, { observacao: event.target.value })}
                    className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
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
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Solicitações em produção</h3>
          {!loading && (
            <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {solicitacoesEmProducao.length} em produção
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando solicitações...</p>
        ) : solicitacoesEmProducao.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma solicitação em produção.</p>
        ) : (
          renderTabelaSolicitacoes(solicitacoesEmProducao, true)
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Solicitações cadastradas</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando solicitações...</p>
        ) : solicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma solicitação criada.</p>
        ) : demaisSolicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma outra solicitação cadastrada.</p>
        ) : (
          renderTabelaSolicitacoes(demaisSolicitacoes, false, true)
        )}
      </section>

      {envioModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Enviar para o Fornecedor</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Etapa {envioEtapa} de 3 — {
                    envioEtapa === 1 ? "Seleção do fornecedor" :
                    envioEtapa === 2 ? "Conferência dos produtos" : "Revisão final do pedido"
                  }
                </p>
              </div>
              <button
                type="button"
                onClick={fecharEnvioFornecedor}
                disabled={envioCarregando || envioEnviando}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {envioEtapa === 1 ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-slate-900">Selecione o fornecedor</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      São exibidos apenas fornecedores com ID do vendedor e ID do aplicativo.
                    </p>
                  </div>

                  {envioCarregando ? (
                    <p className="text-sm text-slate-600">Carregando fornecedores...</p>
                  ) : fornecedoresEnvio.length === 0 ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Nenhum fornecedor possui os dados necessários para continuar.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {fornecedoresEnvio.map((fornecedor) => {
                        const selecionado = fornecedorEnvioId === fornecedor.id;
                        return (
                          <label
                            key={fornecedor.id}
                            className={`cursor-pointer rounded-lg border p-4 transition ${
                              selecionado ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-400"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                name="fornecedor-envio"
                                value={fornecedor.id}
                                checked={selecionado}
                                onChange={() => setFornecedorEnvioId(fornecedor.id)}
                                className="mt-1"
                              />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900">{fornecedor.nome}</p>
                                <p className="mt-2 text-sm text-slate-600">ID vendedor: {fornecedor.vendedor_olist_id}</p>
                                <p className="mt-1 break-all text-sm text-slate-600">ID aplicativo: {fornecedor.aplicativo_id}</p>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : envioEtapa === 2 ? (
                <div className="space-y-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fornecedor selecionado</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {fornecedoresEnvio.find((fornecedor) => fornecedor.id === fornecedorEnvioId)?.nome}
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900">Confira os produtos da solicitação</h4>
                    <p className="mt-1 text-sm text-slate-600">Revise todas as informações antes de continuar.</p>
                  </div>

                  <div className="space-y-4">
                    {itensConferencia.map((item) => {
                      const quantidadeNecessaria = item.produtoFornecido
                        ? item.quantidade_solicitada * item.produtoFornecido.quantidade_por_produto
                        : null;
                      return (
                        <article key={item.id} className="rounded-lg border border-slate-200 p-4 sm:p-5">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {item.quantidade_solicitada} unidades — {item.sku}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">{item.nomeProduto}</p>
                            </div>
                            <span className={`self-start rounded-full px-3 py-1 text-xs font-semibold ${
                              item.tipo_corte === "LASER"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {item.tipo_corte === "LASER" ? "Corte a laser" : "Sem corte a laser"}
                            </span>
                          </div>

                          <div className="mt-4 border-t border-slate-200 pt-4">
                            <p className="text-sm font-semibold text-slate-800">Produto fornecido</p>
                            {item.produtoFornecido ? (
                              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                                <div><dt className="text-slate-500">Referência</dt><dd className="mt-1 font-medium text-slate-800">{item.produtoFornecido.referencia ?? "-"}</dd></div>
                                <div><dt className="text-slate-500">Quantidade necessária</dt><dd className="mt-1 font-medium text-slate-800">{formatarDecimal(quantidadeNecessaria ?? 0)} m</dd></div>
                                <div><dt className="text-slate-500">Nome</dt><dd className="mt-1 font-medium text-slate-800">{item.produtoFornecido.nome}</dd></div>
                              </dl>
                            ) : (
                              <p className="mt-2 text-sm text-slate-500">Nenhum produto fornecido relacionado.</p>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                    Continue para visualizar e editar exatamente o que será enviado à Olist.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <h4 className="font-semibold text-slate-900">Revise o pedido que será enviado</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      Edite os campos necessários. O JSON será montado somente após a confirmação.
                    </p>
                  </div>
                  {pedidoFornecedorEdicao && (
                    <div className="space-y-5">
                      <section className="rounded-lg border border-slate-200 p-4">
                        <h5 className="font-semibold text-slate-900">Dados do pedido</h5>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="text-sm text-slate-700">ID do cliente
                            <input type="number" min={1} value={pedidoFornecedorEdicao.idContato} onChange={(event) => alterarPedidoFornecedor({ idContato: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                          </label>
                          <label className="text-sm text-slate-700">ID do vendedor
                            <input type="number" min={1} value={pedidoFornecedorEdicao.vendedor.id} onChange={(event) => alterarPedidoFornecedor({ vendedor: { id: Number(event.target.value) } })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                          </label>
                          <label className="text-sm text-slate-700">Situação
                            <input type="number" value={pedidoFornecedorEdicao.situacao} onChange={(event) => alterarPedidoFornecedor({ situacao: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                          </label>
                          <label className="text-sm text-slate-700">Data
                            <input type="date" value={pedidoFornecedorEdicao.data} onChange={(event) => alterarPedidoFornecedor({ data: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                          </label>
                        </div>
                        <label className="mt-4 block text-sm text-slate-700">Observações
                          <textarea value={pedidoFornecedorEdicao.observacoes} onChange={(event) => alterarPedidoFornecedor({ observacoes: event.target.value })} className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2" />
                        </label>
                      </section>

                      {pedidoFornecedorEdicao.itens.map((item, index) => (
                        <section key={`${item.produto.id}-${index}`} className="rounded-lg border border-slate-200 p-4">
                          <h5 className="font-semibold text-slate-900">
                            {item.produto.tipo === "S" ? "Serviço" : "Produto"} {index + 1}
                          </h5>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <label className="text-sm text-slate-700">ID do produto
                              <input type="number" min={1} value={item.produto.id} onChange={(event) => alterarItemPedidoFornecedor(index, { produto: { ...item.produto, id: Number(event.target.value) } })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                            </label>
                            <label className="text-sm text-slate-700">Tipo
                              <input value={item.produto.tipo} onChange={(event) => alterarItemPedidoFornecedor(index, { produto: { ...item.produto, tipo: event.target.value } })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                            </label>
                            <label className="text-sm text-slate-700">Quantidade
                              <input type="number" min={0.0001} step="0.0001" value={item.quantidade} onChange={(event) => alterarItemPedidoFornecedor(index, { quantidade: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                            </label>
                            <label className="text-sm text-slate-700">Preço unitário
                              <input type="number" min={0} step="0.01" value={item.valorUnitario} onChange={(event) => alterarItemPedidoFornecedor(index, { valorUnitario: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                            </label>
                          </div>
                          {extrairDivisoesInfoAdicional(item.infoAdicional).map((divisao, divisaoIndex) => (
                            <div key={divisaoIndex} className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estampa/variante {divisaoIndex + 1}</p>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <label className="text-sm text-slate-700">Estampa
                                  <input value={divisao.estampa} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "estampa", event.target.value)} placeholder="Código da estampa" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Variante
                                  <input value={divisao.variante} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "variante", event.target.value)} placeholder="Variante" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Quantidade da divisão
                                  <input type="number" min={0.0001} step="0.0001" value={divisao.quantidade} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "quantidade", event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Unidade
                                  <input value={divisao.unidade} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "unidade", event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Tamanho
                                  <input value={divisao.tamanho} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "tamanho", event.target.value)} placeholder="Ex.: 70x70" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Tipo do produto
                                  <input value={divisao.tipo} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "tipo", event.target.value)} placeholder="Ex.: LENCO-RELIG-FOURWAY" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
                                </label>
                                <label className="text-sm text-slate-700">Corte a laser
                                  <select value={divisao.laser} onChange={(event) => alterarDivisaoPedidoFornecedor(index, divisaoIndex, "laser", event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2">
                                    <option value="false">Não</option>
                                    <option value="true">Sim</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          ))}
                          {item.produto.tipo !== "S" && (
                            <label className="mt-4 block text-sm text-slate-700">Informação adicional
                              <textarea value={item.infoAdicional} onChange={(event) => alterarItemPedidoFornecedor(index, { infoAdicional: event.target.value })} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
                            </label>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                  {envioSucesso && (
                    <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                      Pedido criado com sucesso{envioSucesso.numeroPedido ? `: ${envioSucesso.numeroPedido}` : envioSucesso.id ? `: ID ${envioSucesso.id}` : "."}
                    </p>
                  )}
                </div>
              )}

              {envioErro && (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{envioErro}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 p-5">
              {envioEtapa > 1 && !envioSucesso && (
                <button
                  type="button"
                  onClick={() => setEnvioEtapa((etapa) => etapa === 3 ? 2 : 1)}
                  disabled={envioCarregando || envioEnviando}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Voltar
                </button>
              )}
              {envioEtapa === 1 ? (
                <button
                  type="button"
                  onClick={() => void revisarProdutosFornecedor()}
                  disabled={!fornecedorEnvioId || envioCarregando}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {envioCarregando ? "Carregando..." : "Revisar produtos"}
                </button>
              ) : envioEtapa === 2 ? (
                <button
                  type="button"
                  onClick={() => void prepararPedidoFornecedor()}
                  disabled={envioCarregando || itensConferencia.length === 0}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {envioCarregando ? "Gerando prévia..." : "Revisar pedido final"}
                </button>
              ) : (
                envioSucesso ? (
                  <button
                    type="button"
                    onClick={fecharEnvioFornecedor}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Fechar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void confirmarEnvioFornecedor()}
                    disabled={envioEnviando || !pedidoFornecedorEdicao}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {envioEnviando ? "Criando pedido..." : "Criar pedido na Olist"}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AccessGuard>
  );
}
