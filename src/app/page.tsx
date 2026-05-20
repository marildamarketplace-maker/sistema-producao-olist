"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

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
};

type VendaOlist = {
  sku: string;
  quantidade: number;
};

type Solicitacao = {
  id: string;
  data_entrega: string;
  status: string;
  prioridade_producao: boolean | null;
};

type SolicitacaoDevolucao = {
  id: string;
  status: string;
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

type GrupoSkuIndicador = {
  grupo: string;
  total_vendido: number;
  produtos: number;
  percentual_venda: number;
};

const DASHBOARD_SOLICITACAO_KEY = "dashboard_solicitacao_manual_itens";

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

export default function DashboardPage() {
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
  const [selecionadosBaixoEstoque, setSelecionadosBaixoEstoque] = useState<Set<string>>(new Set());

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
        .select("produto_id, sku, tipo_movimento, quantidade"),
      supabase.from("itens_baixa_estoque_olist").select("sku, quantidade"),
      supabase
        .from("solicitacoes_producao")
        .select("id, data_entrega, status, prioridade_producao"),
      supabase
        .from("solicitacoes_devolucao")
        .select("id, status"),
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
    const configMap = new Map(configs.map((config) => [config.chave, Number(config.valor)]));
    const metaGeral = Number(configMap.get("META_GERAL_ESTOQUE") ?? 0);
    const minimoGeral = Number(configMap.get("MINIMO_GERAL_ESTOQUE") ?? 0);

    const estoquePorProduto = new Map<string, number>();
    const vendasPorSku = new Map<string, number>();

    for (const mov of movimentacoes) {
      const chave = mov.produto_id || mov.sku;
      const atual = estoquePorProduto.get(chave) ?? 0;
      const sinal = mov.tipo_movimento === "saida" ? -1 : 1;

      estoquePorProduto.set(chave, atual + Number(mov.quantidade ?? 0) * sinal);
    }

    for (const venda of vendasOlist) {
      vendasPorSku.set(
        venda.sku,
        (vendasPorSku.get(venda.sku) ?? 0) + Number(venda.quantidade ?? 0),
      );
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

    const solicitacoesEmProducao = solicitacoes.filter(
      (solicitacao) => solicitacao.status === "em_producao",
    );
    const devolucoesPendentes = solicitacoesDevolucao.filter(
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

    return {
      produtosIndicadores,
      produtosAtivos: produtos.length,
      estoqueTotal: produtosIndicadores.reduce((total, produto) => total + produto.saldo_atual, 0),
      totalVendido: produtosIndicadores.reduce((total, produto) => total + produto.total_vendido, 0),
      solicitacoesEmProducao: solicitacoesEmProducao.length,
      solicitacoesPrioridade: solicitacoesEmProducao.filter((solicitacao) => solicitacao.prioridade_producao).length,
      devolucoesTotal: solicitacoesDevolucao.length,
      devolucoesPendentes: devolucoesPendentes.length,
      quantidadePendente,
      maisVendidos: [...produtosIndicadores]
        .filter((produto) => produto.total_vendido > 0)
        .sort((a, b) => b.total_vendido - a.total_vendido)
        .slice(0, 6),
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
  }, [configs, itensSolicitacao, movimentacoes, produtos, solicitacoes, solicitacoesDevolucao, vendasOlist]);

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

  function enviarBaixoEstoqueParaSolicitacao() {
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Visao geral de vendas, estoque e producao."
      />

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {loading ? (
        <p className="text-sm text-slate-600">Carregando indicadores...</p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-7">
            <ResumoCard label="Produtos ativos" value={indicadores.produtosAtivos} />
            <ResumoCard label="Estoque total" value={indicadores.estoqueTotal} />
            <ResumoCard label="Total vendido" value={indicadores.totalVendido} />
            <ResumoCard label="Solicitacoes em producao" value={indicadores.solicitacoesEmProducao} />
            <ResumoCard label="Prioridades abertas" value={indicadores.solicitacoesPrioridade} destaque={indicadores.solicitacoesPrioridade > 0} />
            <ResumoCard
              label="Devolucoes"
              value={indicadores.devolucoesTotal}
              detalhe={`${indicadores.devolucoesPendentes} pendentes`}
              destaque={indicadores.devolucoesPendentes > 0}
            />
            <ResumoCard label="Pecas pendentes" value={indicadores.quantidadePendente} />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <GrupoSkuCard rows={indicadores.gruposMaisVendidos} />

            <RankingCard
              title="Produtos mais vendidos"
              description="Com base nas baixas registradas da Olist."
              emptyMessage="Nenhuma venda registrada."
              rows={indicadores.maisVendidos}
              columns={[
                { label: "SKU", render: (produto) => <ProdutoCell produto={produto} /> },
                { label: "Vendido", align: "right", render: (produto) => produto.total_vendido },
                { label: "Estoque", align: "right", render: (produto) => produto.saldo_atual },
              ]}
            />
          </section>

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
              onToggle={alternarSelecionadoBaixoEstoque}
              onEnviar={enviarBaixoEstoqueParaSolicitacao}
            />
          </section>
        </>
      )}
    </div>
  );
}

function BaixoEstoqueCard({
  rows,
  selecionados,
  onToggle,
  onEnviar,
}: {
  rows: ProdutoIndicador[];
  selecionados: Set<string>;
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
        <button
          type="button"
          onClick={onEnviar}
          disabled={selecionados.size === 0}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Enviar selecionados
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum produto vendido esta abaixo do minimo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 text-left font-medium">Selecionar</th>
                <th className="pb-2 text-left font-medium">SKU</th>
                <th className="pb-2 text-right font-medium">Estoque</th>
                <th className="pb-2 text-right font-medium">Minimo a produzir</th>
                <th className="pb-2 text-right font-medium">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((produto) => (
                <tr key={produto.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3">
                    <input
                      type="checkbox"
                      checked={selecionados.has(produto.id)}
                      onChange={() => onToggle(produto.id)}
                    />
                  </td>
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

function RankingCard({
  title,
  description,
  rows,
  columns,
  emptyMessage,
}: {
  title: string;
  description: string;
  rows: ProdutoIndicador[];
  emptyMessage: string;
  columns: Array<{
    label: string;
    align?: "left" | "right";
    render: (produto: ProdutoIndicador) => React.ReactNode;
  }>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : (
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
              {rows.map((produto) => (
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
      )}
    </section>
  );
}
