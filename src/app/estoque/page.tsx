"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
  meta_estoque: number | null;
};

type Movimentacao = {
  id: string;
  produto_id: string;
  sku: string;
  tipo_movimento: "entrada" | "saida";
  quantidade: number;
  origem: string;
  observacao: string | null;
  created_at: string;
};

type LinhaEstoque = Produto & {
  total_entradas: number;
  total_saidas: number;
  saldo_atual: number;
  meta_aplicada: number;
  qtd_movimentacoes: number;
};

type TipoOperacao = "entrada" | "saida" | "ajuste";
type SortKey =
  | "imagem_url"
  | "sku"
  | "total_entradas"
  | "total_saidas"
  | "saldo_atual"
  | "qtd_movimentacoes";
type SortDirection = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  imagem_url: "Imagem",
  sku: "SKU",
  total_entradas: "Total de entradas",
  total_saidas: "Total de saidas",
  saldo_atual: "Saldo atual",
  qtd_movimentacoes: "Movimentacoes",
};

export default function EstoquePage() {
  const { usuario } = useAuth();
  const [linhas, setLinhas] = useState<LinhaEstoque[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [produtoMovimentacoesAberto, setProdutoMovimentacoesAberto] = useState<LinhaEstoque | null>(null);
  const [metaGeral, setMetaGeral] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingProdutos, setImportingProdutos] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [produtoId, setProdutoId] = useState("");
  const [produtoBusca, setProdutoBusca] = useState("");
  const [produtoBuscaAberta, setProdutoBuscaAberta] = useState(false);
  const [tipoOperacao, setTipoOperacao] = useState<TipoOperacao>("entrada");
  const [quantidade, setQuantidade] = useState("1");
  const [origem, setOrigem] = useState("manual");
  const [observacao, setObservacao] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({
    key: "saldo_atual",
    direction: "desc",
  });
  const podeEditarEstoque = Boolean(usuario?.podeEditarEstoque);

  const produtoSelecionado = useMemo(
    () => produtos.find((produto) => produto.id === produtoId) ?? null,
    [produtoId, produtos],
  );
  const produtosFiltrados = useMemo(() => {
    const busca = produtoBusca.trim().toLowerCase();
    const lista = busca
      ? produtos.filter((produto) => produto.sku.toLowerCase().includes(busca))
      : produtos;

    return lista.slice(0, 12);
  }, [produtoBusca, produtos]);
  const totaisEstoque = useMemo(
    () =>
      linhas.reduce(
        (acc, linha) => ({
          total_entradas: acc.total_entradas + linha.total_entradas,
          total_saidas: acc.total_saidas + linha.total_saidas,
          saldo_atual: acc.saldo_atual + linha.saldo_atual,
          qtd_movimentacoes: acc.qtd_movimentacoes + linha.qtd_movimentacoes,
        }),
        { total_entradas: 0, total_saidas: 0, saldo_atual: 0, qtd_movimentacoes: 0 },
      ),
    [linhas],
  );

  const linhasOrdenadas = useMemo(() => {
    return [...linhas].sort((a, b) => {
      let resultado = 0;

      if (sortConfig.key === "sku") {
        resultado = a.sku.localeCompare(b.sku, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        });
      } else if (sortConfig.key === "imagem_url") {
        resultado = Number(Boolean(a.imagem_url)) - Number(Boolean(b.imagem_url));
      } else {
        resultado =
          Number(a[sortConfig.key] ?? 0) - Number(b[sortConfig.key] ?? 0);
      }

      if (resultado === 0) {
        resultado = a.sku.localeCompare(b.sku, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return sortConfig.direction === "asc" ? resultado : -resultado;
    });
  }, [linhas, sortConfig]);

  const movimentacoesProdutoAberto = useMemo(() => {
    if (!produtoMovimentacoesAberto) return [];

    return movimentacoes.filter((mov) => mov.produto_id === produtoMovimentacoesAberto.id);
  }, [movimentacoes, produtoMovimentacoesAberto]);

  async function carregarDados() {
    setLoading(true);
    setErrorMessage(null);

    const [
      { data: produtosData, error: produtosError },
      { data: movData, error: movError },
      { data: cfgData, error: cfgError },
    ] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, sku, imagem_url, meta_estoque")
        .eq("ativo", true)
        .order("sku"),
      supabase
        .from("movimentacoes_estoque")
        .select("id, produto_id, sku, tipo_movimento, quantidade, origem, observacao, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("configuracoes_sistema")
        .select("valor")
        .eq("chave", "META_GERAL_ESTOQUE")
        .maybeSingle(),
    ]);

    if (produtosError || movError || cfgError) {
      setErrorMessage(
        produtosError?.message ??
          movError?.message ??
          cfgError?.message ??
          "Erro ao carregar estoque.",
      );
      setLoading(false);
      return;
    }

    const metaGlobal = Number(cfgData?.valor ?? 0);
    setMetaGeral(Number.isNaN(metaGlobal) ? 0 : metaGlobal);

    const listaProdutos = (produtosData as Produto[]) ?? [];
    const listaMovimentacoes = (movData as Movimentacao[]) ?? [];
    const mapa = new Map<string, { entradas: number; saidas: number }>();

    listaMovimentacoes.forEach((mov) => {
      const atual = mapa.get(mov.produto_id) ?? { entradas: 0, saidas: 0 };

      if (mov.tipo_movimento === "entrada") {
        atual.entradas += mov.quantidade;
      } else {
        atual.saidas += mov.quantidade;
      }

      mapa.set(mov.produto_id, atual);
    });

    const linhasCalculadas: LinhaEstoque[] = listaProdutos.map((produto) => {
      const totais = mapa.get(produto.id) ?? { entradas: 0, saidas: 0 };
      const qtdMovimentacoes = listaMovimentacoes.filter((mov) => mov.produto_id === produto.id).length;
      const metaAplicada =
        produto.meta_estoque ?? (Number.isNaN(metaGlobal) ? 0 : metaGlobal);

      return {
        ...produto,
        total_entradas: totais.entradas,
        total_saidas: totais.saidas,
        saldo_atual: totais.entradas - totais.saidas,
        meta_aplicada: metaAplicada,
        qtd_movimentacoes: qtdMovimentacoes,
      };
    });

    setProdutos(listaProdutos);
    setMovimentacoes(listaMovimentacoes);
    setLinhas(linhasCalculadas);
    setLoading(false);
  }

  useEffect(() => {
    carregarDados();
  }, []);

  function alterarOrdenacao(key: SortKey) {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortHeader(key: SortKey, total?: number) {
    const ativo = sortConfig.key === key;
    const label = total === undefined ? SORT_LABELS[key] : `${SORT_LABELS[key]} (${total})`;

    return (
      <button
        type="button"
        onClick={() => alterarOrdenacao(key)}
        className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-950"
        aria-label={`Ordenar por ${SORT_LABELS[key]}`}
      >
        <span>{label}</span>
        <span className="min-w-8 text-xs text-slate-400">
          {ativo ? (sortConfig.direction === "asc" ? "Asc" : "Desc") : ""}
        </span>
      </button>
    );
  }

  function alterarProdutoBusca(valor: string) {
    if (!podeEditarEstoque) return;

    setProdutoBusca(valor);
    setProdutoBuscaAberta(true);

    const produto = produtos.find(
      (item) => item.sku.toLowerCase() === valor.trim().toLowerCase(),
    );

    setProdutoId(produto?.id ?? "");
  }

  function selecionarProduto(produto: Produto) {
    if (!podeEditarEstoque) return;

    setProdutoBusca(produto.sku);
    setProdutoId(produto.id);
    setProdutoBuscaAberta(false);
  }

  async function handleAdicionarMovimentacao(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!podeEditarEstoque) return;

    setSaving(true);
    setErrorMessage(null);

    if (!produtoSelecionado) {
      setErrorMessage("Selecione um produto.");
      setSaving(false);
      return;
    }

    const quantidadeNumerica = Number(quantidade);

    if (Number.isNaN(quantidadeNumerica) || quantidadeNumerica === 0) {
      setErrorMessage("Informe uma quantidade valida diferente de zero.");
      setSaving(false);
      return;
    }

    let tipoMovimento: "entrada" | "saida";
    let quantidadeFinal: number;

    if (tipoOperacao === "ajuste") {
      tipoMovimento = quantidadeNumerica > 0 ? "entrada" : "saida";
      quantidadeFinal = Math.abs(quantidadeNumerica);
    } else {
      tipoMovimento = tipoOperacao;
      quantidadeFinal = Math.abs(quantidadeNumerica);
    }

    const { error } = await supabase.from("movimentacoes_estoque").insert({
      produto_id: produtoSelecionado.id,
      sku: produtoSelecionado.sku,
      tipo_movimento: tipoMovimento,
      quantidade: quantidadeFinal,
      origem,
      observacao:
        observacao.trim() || `Movimentacao manual (${tipoOperacao})`,
    });

    if (error) {
      setErrorMessage(`Erro ao adicionar movimentacao: ${error.message}`);
      setSaving(false);
      return;
    }

    setQuantidade("1");
    setObservacao("");
    await carregarDados();
    setSaving(false);
  }

  async function importarProdutosDaOlist() {
    if (!podeEditarEstoque) return;

    setImportingProdutos(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const resp = await axios.post(
      "/api/olist/produtos/importar",
      {},
      { validateStatus: () => true },
    );

    if (resp.status < 200 || resp.status >= 300) {
      setErrorMessage(
        `Erro ao importar produtos da Olist: ${
          resp.data?.error ?? "erro desconhecido"
        }`,
      );
      setImportingProdutos(false);
      return;
    }

    setSuccessMessage(
      `Produtos importados: ${resp.data?.lidos ?? 0}. Criados: ${
        resp.data?.criados ?? 0
      }. Atualizados: ${resp.data?.atualizados ?? 0}. Ignorados: ${
        resp.data?.ignorados ?? 0
      }.`,
    );
    await carregarDados();
    setImportingProdutos(false);
  }

  return (
    <AccessGuard permissions={["podeVisualizarEstoque", "podeEditarEstoque"]}>
      <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <PageHeader
            title="Estoque"
            description="Acompanhe entradas, saidas e saldo atual dos produtos."
          />
          <p className="-mt-4 text-sm text-slate-600">
            Meta geral atual: <strong>{metaGeral}</strong> (usada quando o
            produto nao possui meta individual).
          </p>
        </div>
        {podeEditarEstoque && (
          <button
            type="button"
            onClick={importarProdutosDaOlist}
            disabled={importingProdutos}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {importingProdutos ? "Importando..." : "Importar produtos da Olist"}
          </button>
        )}
      </div>

      {successMessage && (
        <p className="-mt-4 text-sm text-emerald-700">{successMessage}</p>
      )}

      {podeEditarEstoque && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Adicionar movimentacao manual
        </h3>
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
          onSubmit={handleAdicionarMovimentacao}
        >
          <label className="relative text-sm text-slate-700">
            Produto
            <input
              required
              value={produtoBusca}
              onChange={(event) => alterarProdutoBusca(event.target.value)}
              onFocus={() => setProdutoBuscaAberta(true)}
              onBlur={() => {
                window.setTimeout(() => setProdutoBuscaAberta(false), 120);
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Digite o SKU para pesquisar"
            />
            {produtoBuscaAberta && (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {produtosFiltrados.length > 0 ? (
                  produtosFiltrados.map((produto) => (
                    <button
                      key={produto.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selecionarProduto(produto)}
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
            Tipo
            <select
              value={tipoOperacao}
              onChange={(event) =>
                setTipoOperacao(event.target.value as TipoOperacao)
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="entrada">Entrada</option>
              <option value="saida">Saida</option>
              <option value="ajuste">Ajuste (+/-)</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Quantidade {tipoOperacao === "ajuste" ? "(use negativo para baixar)" : ""}
            <input
              required
              type="number"
              value={quantidade}
              onChange={(event) => setQuantidade(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700 md:col-span-2">
            Origem
            <input
              required
              value={origem}
              onChange={(event) => setOrigem(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="manual, inventario, correcao..."
            />
          </label>
          <label className="text-sm text-slate-700">
            Observacao
            <input
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Adicionar movimentacao"}
            </button>
          </div>
        </form>
        {errorMessage && (
          <p className="mt-4 text-sm text-red-600">{errorMessage}</p>
        )}
      </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Posicao de estoque
        </h3>
        {loading ? (
          <p className="text-sm text-slate-600">Carregando estoque...</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum produto encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">{renderSortHeader("imagem_url")}</th>
                  <th className="p-3">{renderSortHeader("sku")}</th>
                  <th className="p-3">{renderSortHeader("total_entradas", totaisEstoque.total_entradas)}</th>
                  <th className="p-3">{renderSortHeader("total_saidas", totaisEstoque.total_saidas)}</th>
                  <th className="p-3">{renderSortHeader("saldo_atual", totaisEstoque.saldo_atual)}</th>
                  <th className="p-3">{renderSortHeader("qtd_movimentacoes", totaisEstoque.qtd_movimentacoes)}</th>
                  <th className="p-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {linhasOrdenadas.map((linha) => (
                  <tr key={linha.id} className="border-b border-slate-100">
                    <td className="p-3">
                      {linha.imagem_url ? (
                        <img
                          src={linha.imagem_url}
                          alt={linha.sku}
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
                          Sem imagem
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-medium text-slate-700">
                      {linha.sku}
                    </td>
                    <td className="p-3 text-slate-700">
                      {linha.total_entradas}
                    </td>
                    <td className="p-3 text-slate-700">{linha.total_saidas}</td>
                    <td className="p-3 font-semibold text-slate-900">
                      {linha.saldo_atual}
                    </td>
                    <td className="p-3 text-slate-700">
                      {linha.qtd_movimentacoes}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => setProdutoMovimentacoesAberto(linha)}
                        disabled={linha.qtd_movimentacoes === 0}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Ver movimentacoes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {produtoMovimentacoesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Movimentacoes de estoque
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {produtoMovimentacoesAberto.sku} - {movimentacoesProdutoAberto.length} movimentacoes
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProdutoMovimentacoesAberto(null)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {movimentacoesProdutoAberto.length === 0 ? (
                <p className="text-sm text-slate-600">Nenhuma movimentacao para este item.</p>
              ) : (
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="p-3">Data</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Quantidade</th>
                      <th className="p-3">Origem</th>
                      <th className="p-3">Observacao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimentacoesProdutoAberto.map((mov) => (
                      <tr key={mov.id} className="border-b border-slate-100">
                        <td className="p-3 text-slate-700">
                          {new Date(mov.created_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-semibold uppercase ${
                              mov.tipo_movimento === "entrada"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-red-50 text-red-700"
                            }`}
                          >
                            {mov.tipo_movimento}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-slate-900">{mov.quantidade}</td>
                        <td className="p-3 text-slate-700">{mov.origem}</td>
                        <td className="p-3 text-slate-700">{mov.observacao || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AccessGuard>
  );
}
