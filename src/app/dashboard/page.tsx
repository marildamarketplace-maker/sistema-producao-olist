"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";
import { supabase } from "@/lib/supabase";
import { hasAnyPermission } from "@/lib/permissions";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
  meta_estoque: number | null;
  minimo_estoque: number | null;
  ativo: boolean;
};

type Movimentacao = {
  produto_id: string | null;
  sku: string;
  tipo_movimento: string;
  quantidade: number;
  created_at: string;
};

type VendaOlist = {
  sku: string;
  quantidade: number;
  created_at: string;
};

type Solicitacao = {
  id: string;
  data_entrega: string;
  status: string;
  prioridade_producao: boolean | null;
  created_at: string;
};

type SolicitacaoDevolucao = {
  id: string;
  status: string;
  created_at: string;
};

type ItemSolicitacao = {
  solicitacao_id: string;
  sku: string;
  quantidade_solicitada: number;
  quantidade_produzida: number | null;
};

type Configuracao = {
  chave: string;
  valor: number | string;
};

type ProdutoIndicador = Produto & {
  saldo_atual: number;
  total_vendido: number;
  meta_aplicada: number;
  minimo_aplicado: number;
};

type ProdutoParadoIndicador = ProdutoIndicador & {
  ultima_venda: string | null;
  dias_sem_venda: number | null;
};

type GrupoSkuIndicador = {
  grupo: string;
  total_vendido: number;
  produtos: number;
  percentual_venda: number;
};

type PeriodoRapido = "" | "7" | "15" | "30" | "60" | "90";

const DASHBOARD_SOLICITACAO_KEY = "dashboard_solicitacao_manual_itens";

const PERIODOS_RAPIDOS: Array<{ label: string; value: PeriodoRapido }> = [
  { label: "Periodo manual", value: "" },
  { label: "Ultimos 7 dias", value: "7" },
  { label: "Ultimos 15 dias", value: "15" },
  { label: "Ultimos 30 dias", value: "30" },
  { label: "Ultimos 60 dias", value: "60" },
  { label: "Ultimos 90 dias", value: "90" },
];

function arredondarParaPar(valor: number) {
  return valor % 2 === 0 ? valor : valor + 1;
}

function extrairGrupoSku(sku: string) {
  const partes = sku
    .trim()
    .split("-")
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes[0]?.toUpperCase() === "FMR") {
    return "FMR";
  }

  if (partes.length >= 2) {
    return `${partes[0]}-${partes[1]}`.toUpperCase();
  }

  return (partes[0] || sku).toUpperCase();
}

function criarLimiteData(data: string, fimDoDia = false) {
  if (!data) return null;

  const limite = new Date(`${data}T00:00:00`);

  if (Number.isNaN(limite.getTime())) return null;

  if (fimDoDia) {
    limite.setHours(23, 59, 59, 999);
  }

  return limite;
}

function formatarDataInput(data: Date) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function calcularPeriodoRapido(dias: number) {
  const fim = new Date();
  const inicio = new Date(fim);

  inicio.setDate(fim.getDate() - (dias - 1));

  return {
    dataInicial: formatarDataInput(inicio),
    dataFinal: formatarDataInput(fim),
  };
}

function estaNoPeriodo(dataValor: string | null | undefined, dataInicial: Date | null, dataFinal: Date | null) {
  if (!dataInicial && !dataFinal) return true;
  if (!dataValor) return false;

  const data = new Date(dataValor);

  if (Number.isNaN(data.getTime())) return false;
  if (dataInicial && data < dataInicial) return false;
  if (dataFinal && data > dataFinal) return false;

  return true;
}

function escaparCampoCsv(valor: string | number) {
  const texto = String(valor);

  if (!/[",\n\r]/.test(texto)) return texto;

  return `"${texto.replaceAll("\"", "\"\"")}"`;
}

function calcularDiasDesde(dataValor: string) {
  const data = new Date(dataValor);

  if (Number.isNaN(data.getTime())) return null;

  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const inicioData = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const dias = Math.floor((inicioHoje.getTime() - inicioData.getTime()) / 86_400_000);

  return Math.max(0, dias);
}

function formatarDataHora(dataValor: string | null) {
  if (!dataValor) return "Sem venda registrada";

  const data = new Date(dataValor);

  if (Number.isNaN(data.getTime())) return "Sem venda registrada";

  return data.toLocaleDateString("pt-BR");
}

export default function DashboardPage() {
  const { usuario } = useAuth();
  const router = useRouter();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [vendasOlist, setVendasOlist] = useState<VendaOlist[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [solicitacoesDevolucao, setSolicitacoesDevolucao] = useState<SolicitacaoDevolucao[]>([]);
  const [itensSolicitacao, setItensSolicitacao] = useState<ItemSolicitacao[]>([]);
  const [configs, setConfigs] = useState<Configuracao[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [periodoRapido, setPeriodoRapido] = useState<PeriodoRapido>("");
  const [selecionadosBaixoEstoque, setSelecionadosBaixoEstoque] = useState<Set<string>>(new Set());
  const podeVerEstoque = hasAnyPermission(usuario, ["podeVisualizarEstoque", "podeEditarEstoque"]);
  const podeVerBaixa = hasAnyPermission(usuario, ["podeVisualizarBaixa", "podeSolicitarBaixa"]);
  const podeVerProducao = hasAnyPermission(usuario, [
    "podeVisualizarProducao",
    "podeSolicitarProducao",
    "podeConfirmarProducao",
  ]);
  const podeVerDevolucao = hasAnyPermission(usuario, [
    "podeVisualizarDevolucao",
    "podeSolicitarDevolucao",
  ]);
  const podeSolicitarProducao = Boolean(usuario?.podeSolicitarProducao);

  async function carregarDashboard() {
    setLoading(true);
    setErrorMessage(null);

    const [
      produtosResp,
      movimentacoesResp,
      vendasResp,
      solicitacoesResp,
      devolucoesResp,
      itensResp,
      configsResp,
    ] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, sku, imagem_url, meta_estoque, minimo_estoque, ativo")
        .eq("ativo", true),
      supabase
        .from("movimentacoes_estoque")
        .select("produto_id, sku, tipo_movimento, quantidade, created_at"),
      supabase.from("itens_baixa_estoque_olist").select("sku, quantidade, created_at"),
      supabase
        .from("solicitacoes_producao")
        .select("id, data_entrega, status, prioridade_producao, created_at"),
      supabase
        .from("solicitacoes_devolucao")
        .select("id, status, created_at"),
      supabase
        .from("itens_solicitacao_producao")
        .select("solicitacao_id, sku, quantidade_solicitada, quantidade_produzida"),
      supabase
        .from("configuracoes_sistema")
        .select("chave, valor")
        .in("chave", ["META_GERAL_ESTOQUE", "MINIMO_GERAL_ESTOQUE"]),
    ]);

    const erro =
      produtosResp.error ??
      movimentacoesResp.error ??
      vendasResp.error ??
      solicitacoesResp.error ??
      itensResp.error ??
      configsResp.error;

    if (erro) {
      setErrorMessage(`Erro ao carregar dashboard: ${erro.message}`);
      setLoading(false);
      return;
    }

    setProdutos((produtosResp.data as Produto[]) ?? []);
    setMovimentacoes((movimentacoesResp.data as Movimentacao[]) ?? []);
    setVendasOlist((vendasResp.data as VendaOlist[]) ?? []);
    setSolicitacoes((solicitacoesResp.data as Solicitacao[]) ?? []);
    setSolicitacoesDevolucao(devolucoesResp.error ? [] : ((devolucoesResp.data as SolicitacaoDevolucao[]) ?? []));
    setItensSolicitacao((itensResp.data as ItemSolicitacao[]) ?? []);
    setConfigs((configsResp.data as Configuracao[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    carregarDashboard();
  }, []);

  const indicadores = useMemo(() => {
    const inicioPeriodo = criarLimiteData(dataInicial);
    const fimPeriodo = criarLimiteData(dataFinal, true);
    const periodoInvalido = Boolean(inicioPeriodo && fimPeriodo && inicioPeriodo > fimPeriodo);
    const vendasPeriodo = periodoInvalido
      ? []
      : vendasOlist.filter((venda) => estaNoPeriodo(venda.created_at, inicioPeriodo, fimPeriodo));
    const solicitacoesPeriodo = periodoInvalido
      ? []
      : solicitacoes.filter((solicitacao) =>
          estaNoPeriodo(solicitacao.created_at, inicioPeriodo, fimPeriodo),
        );
    const solicitacoesDevolucaoPeriodo = periodoInvalido
      ? []
      : solicitacoesDevolucao.filter((solicitacao) =>
          estaNoPeriodo(solicitacao.created_at, inicioPeriodo, fimPeriodo),
        );
    const configMap = new Map(configs.map((config) => [config.chave, Number(config.valor)]));
    const metaGeral = Number(configMap.get("META_GERAL_ESTOQUE") ?? 0);
    const minimoGeral = Number(configMap.get("MINIMO_GERAL_ESTOQUE") ?? 0);

    const estoquePorProduto = new Map<string, number>();
    const vendasPorSku = new Map<string, number>();
    const ultimaVendaPorSku = new Map<string, string>();

    for (const mov of movimentacoes) {
      const chave = mov.produto_id || mov.sku;
      const atual = estoquePorProduto.get(chave) ?? 0;
      const sinal = mov.tipo_movimento === "saida" ? -1 : 1;

      estoquePorProduto.set(chave, atual + Number(mov.quantidade ?? 0) * sinal);
    }

    for (const venda of vendasPeriodo) {
      vendasPorSku.set(
        venda.sku,
        (vendasPorSku.get(venda.sku) ?? 0) + Number(venda.quantidade ?? 0),
      );
    }

    for (const venda of vendasOlist) {
      const dataAtual = ultimaVendaPorSku.get(venda.sku);

      if (!dataAtual || new Date(venda.created_at).getTime() > new Date(dataAtual).getTime()) {
        ultimaVendaPorSku.set(venda.sku, venda.created_at);
      }
    }

    const produtosIndicadores: ProdutoIndicador[] = produtos.map((produto) => ({
      ...produto,
      saldo_atual:
        estoquePorProduto.get(produto.id) ?? estoquePorProduto.get(produto.sku) ?? 0,
      total_vendido: vendasPorSku.get(produto.sku) ?? 0,
      meta_aplicada: produto.meta_estoque ?? metaGeral,
      minimo_aplicado: produto.minimo_estoque ?? minimoGeral,
    }));
    const gruposMap = new Map<string, GrupoSkuIndicador>();

    for (const produto of produtosIndicadores) {
      if (produto.total_vendido <= 0) continue;

      const grupo = extrairGrupoSku(produto.sku);
      const atual = gruposMap.get(grupo) ?? {
        grupo,
        total_vendido: 0,
        produtos: 0,
        percentual_venda: 0,
      };

      gruposMap.set(grupo, {
        grupo,
        total_vendido: atual.total_vendido + produto.total_vendido,
        produtos: atual.produtos + 1,
        percentual_venda: 0,
      });
    }
    const totalVendidoGeral = [...gruposMap.values()].reduce(
      (total, grupo) => total + grupo.total_vendido,
      0,
    );
    const gruposMaisVendidos = [...gruposMap.values()].map((grupo) => ({
      ...grupo,
      percentual_venda:
        totalVendidoGeral > 0 ? (grupo.total_vendido / totalVendidoGeral) * 100 : 0,
    }));

    const solicitacoesEmProducao = solicitacoesPeriodo.filter(
      (solicitacao) => solicitacao.status === "em_producao",
    );
    const devolucoesPendentes = solicitacoesDevolucaoPeriodo.filter(
      (solicitacao) => solicitacao.status === "pendente",
    );
    const idsEmProducao = new Set(solicitacoesEmProducao.map((solicitacao) => solicitacao.id));
    const quantidadePendente = itensSolicitacao
      .filter((item) => idsEmProducao.has(item.solicitacao_id))
      .reduce(
        (total, item) =>
          total +
          Math.max(
            0,
            Number(item.quantidade_solicitada ?? 0) -
              Number(item.quantidade_produzida ?? 0),
          ),
        0,
      );
    const produtosVendidos = [...produtosIndicadores]
      .filter((produto) => produto.total_vendido > 0)
      .sort((a, b) => b.total_vendido - a.total_vendido);
    const produtosParados = produtosIndicadores
      .filter((produto) => produto.saldo_atual > 0)
      .map((produto): ProdutoParadoIndicador => {
        const ultimaVenda = ultimaVendaPorSku.get(produto.sku) ?? null;

        return {
          ...produto,
          ultima_venda: ultimaVenda,
          dias_sem_venda: ultimaVenda ? calcularDiasDesde(ultimaVenda) : null,
        };
      })
      .sort((a, b) => {
        if (a.dias_sem_venda === null && b.dias_sem_venda === null) {
          return b.saldo_atual - a.saldo_atual;
        }

        if (a.dias_sem_venda === null) return -1;
        if (b.dias_sem_venda === null) return 1;

        return b.dias_sem_venda === a.dias_sem_venda
          ? b.saldo_atual - a.saldo_atual
          : b.dias_sem_venda - a.dias_sem_venda;
      });

    return {
      produtosIndicadores,
      produtosAtivos: produtos.length,
      estoqueTotal: produtosIndicadores.reduce((total, produto) => total + produto.saldo_atual, 0),
      totalVendido: produtosIndicadores.reduce((total, produto) => total + produto.total_vendido, 0),
      solicitacoesEmProducao: solicitacoesEmProducao.length,
      solicitacoesPrioridade: solicitacoesEmProducao.filter((solicitacao) => solicitacao.prioridade_producao).length,
      devolucoesTotal: solicitacoesDevolucaoPeriodo.length,
      devolucoesPendentes: devolucoesPendentes.length,
      quantidadePendente,
      produtosVendidos,
      produtosParados,
      produtosParadosMaisDe7Dias: produtosParados.filter(
        (produto) => produto.dias_sem_venda !== null && produto.dias_sem_venda > 7,
      ),
      gruposMaisVendidos: gruposMaisVendidos
        .sort((a, b) => b.total_vendido - a.total_vendido)
        .slice(0, 6),
      maiorEstoque: [...produtosIndicadores]
        .sort((a, b) => b.saldo_atual - a.saldo_atual)
        .slice(0, 6),
      vendidosComBaixoEstoque: [...produtosIndicadores]
        .filter(
          (produto) =>
            produto.total_vendido > 0 && produto.saldo_atual <= produto.minimo_aplicado,
        )
        .sort((a, b) => {
          const folgaA = a.saldo_atual - a.minimo_aplicado;
          const folgaB = b.saldo_atual - b.minimo_aplicado;

          return folgaA === folgaB ? b.total_vendido - a.total_vendido : folgaA - folgaB;
        })
        .slice(0, 6),
    };
  }, [
    configs,
    dataFinal,
    dataInicial,
    itensSolicitacao,
    movimentacoes,
    produtos,
    solicitacoes,
    solicitacoesDevolucao,
    vendasOlist,
  ]);

  const periodoInvalido = useMemo(() => {
    const inicioPeriodo = criarLimiteData(dataInicial);
    const fimPeriodo = criarLimiteData(dataFinal, true);

    return Boolean(inicioPeriodo && fimPeriodo && inicioPeriodo > fimPeriodo);
  }, [dataFinal, dataInicial]);

  function alternarSelecionadoBaixoEstoque(produtoId: string) {
    setSelecionadosBaixoEstoque((anteriores) => {
      const proximos = new Set(anteriores);

      if (proximos.has(produtoId)) {
        proximos.delete(produtoId);
      } else {
        proximos.add(produtoId);
      }

      return proximos;
    });
  }

  function selecionarPeriodoRapido(valor: PeriodoRapido) {
    setPeriodoRapido(valor);

    if (!valor) return;

    const periodo = calcularPeriodoRapido(Number(valor));

    setDataInicial(periodo.dataInicial);
    setDataFinal(periodo.dataFinal);
  }

  function alterarDataInicial(valor: string) {
    setPeriodoRapido("");
    setDataInicial(valor);
  }

  function alterarDataFinal(valor: string) {
    setPeriodoRapido("");
    setDataFinal(valor);
  }

  function limparDatas() {
    setPeriodoRapido("");
    setDataInicial("");
    setDataFinal("");
  }

  function enviarBaixoEstoqueParaSolicitacao() {
    if (!podeSolicitarProducao) return;

    const itensSelecionados = indicadores.vendidosComBaixoEstoque
      .filter((produto) => selecionadosBaixoEstoque.has(produto.id))
      .map((produto) => ({
        produto_id: produto.id,
        sku: produto.sku,
        quantidade_solicitada: arredondarParaPar(Math.max(1, produto.minimo_aplicado)),
        observacao: "Gerado pelo dashboard: vendido com baixo estoque",
      }));

    if (itensSelecionados.length === 0) return;

    window.localStorage.setItem(
      DASHBOARD_SOLICITACAO_KEY,
      JSON.stringify(itensSelecionados),
    );
    router.push("/solicitacoes-producao");
  }

  function exportarProdutosVendidosCsv() {
    const cabecalho = ["SKU", "Vendido", "Estoque", "Meta estoque", "Minimo estoque"];
    const linhas = indicadores.produtosVendidos.map((produto) => [
      produto.sku,
      produto.total_vendido,
      produto.saldo_atual,
      produto.meta_aplicada,
      produto.minimo_aplicado,
    ]);
    const conteudoCsv = [cabecalho, ...linhas]
      .map((linha) => linha.map(escaparCampoCsv).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${conteudoCsv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const sufixoPeriodo =
      dataInicial || dataFinal
        ? `${dataInicial || "inicio"}_${dataFinal || "fim"}`
        : "todo-periodo";

    link.href = url;
    link.download = `produtos-vendidos-${sufixoPeriodo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportarProdutosParadosCsv() {
    const cabecalho = ["SKU", "Estoque", "Ultima venda", "Dias sem vender", "Vendido no periodo"];
    const linhas = indicadores.produtosParadosMaisDe7Dias.map((produto) => [
      produto.sku,
      produto.saldo_atual,
      formatarDataHora(produto.ultima_venda),
      produto.dias_sem_venda ?? "Sem venda registrada",
      produto.total_vendido,
    ]);
    const conteudoCsv = [cabecalho, ...linhas]
      .map((linha) => linha.map(escaparCampoCsv).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${conteudoCsv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "produtos-em-estoque-sem-venda-mais-de-7-dias.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <AccessGuard permissions={["podeVisualizarDashboard"]}>
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Visao geral de vendas, estoque e producao."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Periodo rapido</span>
            <select
              value={periodoRapido}
              onChange={(event) => selecionarPeriodoRapido(event.target.value as PeriodoRapido)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            >
              {PERIODOS_RAPIDOS.map((periodo) => (
                <option key={periodo.value || "manual"} value={periodo.value}>
                  {periodo.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Data inicial</span>
            <input
              type="date"
              value={dataInicial}
              onChange={(event) => alterarDataInicial(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Data final</span>
            <input
              type="date"
              value={dataFinal}
              onChange={(event) => alterarDataFinal(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
          </label>
          <button
            type="button"
            onClick={limparDatas}
            disabled={!dataInicial && !dataFinal && !periodoRapido}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Limpar datas
          </button>
        </div>
        <p className={`mt-3 text-sm ${periodoInvalido ? "text-red-600" : "text-slate-500"}`}>
          {periodoInvalido
            ? "A data inicial precisa ser menor ou igual a data final."
            : "Sem datas selecionadas, os indicadores consideram todo o periodo."}
        </p>
      </section>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {loading ? (
        <p className="text-sm text-slate-600">Carregando indicadores...</p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-7">
            {podeVerEstoque && <ResumoCard label="Produtos ativos" value={indicadores.produtosAtivos} />}
            {podeVerEstoque && <ResumoCard label="Estoque total" value={indicadores.estoqueTotal} />}
            {podeVerBaixa && <ResumoCard label="Total vendido" value={indicadores.totalVendido} />}
            {podeVerProducao && <ResumoCard label="Solicitacoes em producao" value={indicadores.solicitacoesEmProducao} />}
            {podeVerProducao && <ResumoCard label="Prioridades abertas" value={indicadores.solicitacoesPrioridade} destaque={indicadores.solicitacoesPrioridade > 0} />}
            {podeVerDevolucao && (
              <ResumoCard
                label="Devolucoes"
                value={indicadores.devolucoesTotal}
                detalhe={`${indicadores.devolucoesPendentes} pendentes`}
                destaque={indicadores.devolucoesPendentes > 0}
              />
            )}
            {podeVerProducao && <ResumoCard label="Pecas pendentes" value={indicadores.quantidadePendente} />}
          </section>

          {(podeVerBaixa || podeVerEstoque) && (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {podeVerBaixa && <GrupoSkuCard rows={indicadores.gruposMaisVendidos} />}

              {podeVerBaixa && podeVerEstoque && (
                <RankingCard
                  title="Produtos mais vendidos"
                  description="Com base nas baixas registradas da Olist."
                  emptyMessage="Nenhuma venda registrada."
                  rows={indicadores.produtosVendidos}
                  paginated
                  headerAction={
                    <button
                      type="button"
                      onClick={exportarProdutosVendidosCsv}
                      disabled={indicadores.produtosVendidos.length === 0 || periodoInvalido}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Exportar CSV
                    </button>
                  }
                  columns={[
                    { label: "SKU", render: (produto) => <ProdutoCell produto={produto} /> },
                    { label: "Vendido", align: "right", render: (produto) => produto.total_vendido },
                    { label: "Estoque", align: "right", render: (produto) => produto.saldo_atual },
                  ]}
                />
              )}
            </section>
          )}

          {podeVerEstoque && (
            <>
              <ProdutosParadosCard
                rows={indicadores.produtosParadosMaisDe7Dias}
                totalExportacao={indicadores.produtosParadosMaisDe7Dias.length}
                onExportar={exportarProdutosParadosCsv}
              />

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <RankingCard
                  title="Maior estoque"
                  description="Produtos com mais saldo disponivel."
                  emptyMessage="Nenhum produto ativo encontrado."
                  rows={indicadores.maiorEstoque}
                  columns={[
                    { label: "SKU", render: (produto) => <ProdutoCell produto={produto} /> },
                    { label: "Estoque", align: "right", render: (produto) => produto.saldo_atual },
                    { label: "Meta", align: "right", render: (produto) => produto.meta_aplicada },
                  ]}
                />

                <BaixoEstoqueCard
                  rows={indicadores.vendidosComBaixoEstoque}
                  selecionados={selecionadosBaixoEstoque}
                  canSend={podeSolicitarProducao}
                  onToggle={alternarSelecionadoBaixoEstoque}
                  onEnviar={enviarBaixoEstoqueParaSolicitacao}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
    </AccessGuard>
  );
}

function BaixoEstoqueCard({
  rows,
  selecionados,
  canSend,
  onToggle,
  onEnviar,
}: {
  rows: ProdutoIndicador[];
  selecionados: Set<string>;
  canSend: boolean;
  onToggle: (produtoId: string) => void;
  onEnviar: () => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Vendidos com baixo estoque</h3>
          <p className="mt-1 text-sm text-slate-600">
            Selecione itens para preencher uma nova solicitacao manual com a quantidade minima.
          </p>
        </div>
        {canSend && (
          <button
            type="button"
            onClick={onEnviar}
            disabled={selecionados.size === 0}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar selecionados
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum produto vendido esta abaixo do minimo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                {canSend && <th className="pb-2 text-left font-medium">Selecionar</th>}
                <th className="pb-2 text-left font-medium">SKU</th>
                <th className="pb-2 text-right font-medium">Estoque</th>
                <th className="pb-2 text-right font-medium">Minimo a produzir</th>
                <th className="pb-2 text-right font-medium">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((produto) => (
                <tr key={produto.id} className="border-b border-slate-100 last:border-0">
                  {canSend && (
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={selecionados.has(produto.id)}
                        onChange={() => onToggle(produto.id)}
                      />
                    </td>
                  )}
                  <td className="py-3 text-slate-700">
                    <ProdutoCell produto={produto} />
                  </td>
                  <td className="py-3 text-right text-slate-700">{produto.saldo_atual}</td>
                  <td className="py-3 text-right font-semibold text-slate-900">
                    {arredondarParaPar(Math.max(1, produto.minimo_aplicado))}
                  </td>
                  <td className="py-3 text-right text-slate-700">{produto.total_vendido}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GrupoSkuCard({ rows }: { rows: GrupoSkuIndicador[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-950">Familias de SKU que mais vendem</h3>
        <p className="mt-1 text-sm text-slate-600">
          Agrupado pelo inicio do SKU, como PAINEL-RELIGIOSO, LENCO-COUNTRY ou FMR.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma venda registrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 text-left font-medium">Familia</th>
                <th className="pb-2 text-right font-medium">Vendido</th>
                <th className="pb-2 text-right font-medium">% venda</th>
                <th className="pb-2 text-right font-medium">SKUs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.grupo} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 font-semibold text-slate-800">{row.grupo}</td>
                  <td className="py-3 text-right text-slate-700">{row.total_vendido}</td>
                  <td className="py-3 text-right text-slate-700">{row.percentual_venda.toFixed(1)}%</td>
                  <td className="py-3 text-right text-slate-700">{row.produtos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResumoCard({
  label,
  value,
  detalhe,
  destaque = false,
}: {
  label: string;
  value: number;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${destaque ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${destaque ? "text-red-700" : "text-slate-500"}`}>
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${destaque ? "text-red-700" : "text-slate-950"}`}>
        {value}
      </p>
      {detalhe && (
        <p className={`mt-1 text-xs font-medium ${destaque ? "text-red-700" : "text-slate-500"}`}>
          {detalhe}
        </p>
      )}
    </div>
  );
}

function ProdutoCell({ produto }: { produto: ProdutoIndicador }) {
  return (
    <span className="font-medium text-slate-800">{produto.sku}</span>
  );
}

function ProdutosParadosCard({
  rows,
  totalExportacao,
  onExportar,
}: {
  rows: ProdutoParadoIndicador[];
  totalExportacao: number;
  onExportar: () => void;
}) {
  const itensPorPagina = 8;
  const [paginaAtual, setPaginaAtual] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(rows.length / itensPorPagina));
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const inicio = (paginaSegura - 1) * itensPorPagina;
  const rowsPagina = rows.slice(inicio, inicio + itensPorPagina);
  const maiorDias = rowsPagina.reduce(
    (maior, produto) => Math.max(maior, produto.dias_sem_venda ?? 0),
    0,
  );
  const mostrandoInicio = rows.length === 0 ? 0 : inicio + 1;
  const mostrandoFim = Math.min(inicio + itensPorPagina, rows.length);

  useEffect(() => {
    setPaginaAtual(1);
  }, [rows]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Produtos parados em estoque</h3>
          <p className="mt-1 text-sm text-slate-600">
            Produtos com saldo positivo e mais de 7 dias desde a ultima venda.
          </p>
        </div>
        <button
          type="button"
          onClick={onExportar}
          disabled={totalExportacao === 0}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          Exportar CSV &gt; 7 dias
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum produto com mais de 7 dias sem vender encontrado.</p>
      ) : (
        <div className="space-y-4">
          {rowsPagina.map((produto) => {
            const semVenda = produto.dias_sem_venda === null;
            const diasSemVenda = produto.dias_sem_venda ?? 0;
            const percentual =
              semVenda || maiorDias === 0
                ? 100
                : Math.max(8, (diasSemVenda / maiorDias) * 100);

            return (
              <div key={produto.id} className="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(180px,2fr)] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{produto.sku}</p>
                  <p className="text-xs text-slate-500">
                    Estoque {produto.saldo_atual} - Ultima venda: {formatarDataHora(produto.ultima_venda)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 flex-1 overflow-hidden rounded-md bg-slate-100">
                    <div
                      className={`flex h-full items-center justify-end rounded-md px-2 text-xs font-semibold text-white ${
                        semVenda ? "bg-red-700" : "bg-amber-600"
                      }`}
                      style={{ width: `${percentual}%` }}
                    >
                      {semVenda ? "Sem venda" : `${diasSemVenda} dias`}
                    </div>
                  </div>
                  <span className="w-20 text-right text-xs font-medium text-slate-600">
                    {semVenda ? "sem venda" : `${diasSemVenda}d`}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-slate-500">
              Mostrando {mostrandoInicio}-{mostrandoFim} de {rows.length}. CSV inclui {totalExportacao} produto(s).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaginaAtual((pagina) => Math.max(1, pagina - 1))}
                disabled={paginaSegura === 1}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="w-20 text-center text-xs font-medium text-slate-600">
                {paginaSegura} / {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPaginaAtual((pagina) => Math.min(totalPaginas, pagina + 1))}
                disabled={paginaSegura === totalPaginas}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Proxima
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RankingCard({
  title,
  description,
  rows,
  columns,
  emptyMessage,
  headerAction,
  paginated = false,
}: {
  title: string;
  description: string;
  rows: ProdutoIndicador[];
  emptyMessage: string;
  headerAction?: React.ReactNode;
  paginated?: boolean;
  columns: Array<{
    label: string;
    align?: "left" | "right";
    render: (produto: ProdutoIndicador) => React.ReactNode;
  }>;
}) {
  const itensPorPagina = 8;
  const [paginaAtual, setPaginaAtual] = useState(1);
  const totalPaginas = paginated ? Math.max(1, Math.ceil(rows.length / itensPorPagina)) : 1;
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const inicio = paginated ? (paginaSegura - 1) * itensPorPagina : 0;
  const rowsVisiveis = paginated ? rows.slice(inicio, inicio + itensPorPagina) : rows;
  const mostrandoInicio = rows.length === 0 ? 0 : inicio + 1;
  const mostrandoFim = paginated ? Math.min(inicio + itensPorPagina, rows.length) : rows.length;

  useEffect(() => {
    setPaginaAtual(1);
  }, [rows]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {headerAction}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {columns.map((column) => (
                    <th
                      key={column.label}
                      className={`pb-2 font-medium ${column.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsVisiveis.map((produto) => (
                  <tr key={produto.id} className="border-b border-slate-100 last:border-0">
                    {columns.map((column) => (
                      <td
                        key={column.label}
                        className={`py-3 text-slate-700 ${column.align === "right" ? "text-right" : "text-left"}`}
                      >
                        {column.render(produto)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {paginated && (
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                Mostrando {mostrandoInicio}-{mostrandoFim} de {rows.length}.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPaginaAtual((pagina) => Math.max(1, pagina - 1))}
                  disabled={paginaSegura === 1}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="w-20 text-center text-xs font-medium text-slate-600">
                  {paginaSegura} / {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPaginaAtual((pagina) => Math.min(totalPaginas, pagina + 1))}
                  disabled={paginaSegura === totalPaginas}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                >
                  Proxima
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
