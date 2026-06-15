"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle, Plus, Trash2 } from "lucide-react";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
};

type SolicitacaoDevolucao = {
  id: string;
  status: string;
  pedido_referencia: string | null;
  observacao_geral: string | null;
  created_at: string;
  confirmada_em: string | null;
};

type ItemSolicitacaoDevolucao = {
  id: string;
  solicitacao_id: string;
  produto_id: string;
  sku: string;
  imagem_url: string | null;
  quantidade_solicitada: number;
  quantidade_confirmada: number;
  observacao: string | null;
  status_item: string;
};

type ItemForm = {
  produto_id: string;
  produto_busca: string;
  quantidade_solicitada: string;
  observacao: string;
};

const ITEM_INICIAL: ItemForm = {
  produto_id: "",
  produto_busca: "",
  quantidade_solicitada: "1",
  observacao: "",
};

function formatarStatus(status: string) {
  if (status === "pendente") return "PENDENTE";
  if (status === "concluida") return "CONCLUIDA";
  if (status === "cancelada") return "CANCELADA";
  return status.toUpperCase();
}

export default function DevolucoesPage() {
  const { usuario } = useAuth();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoDevolucao[]>([]);
  const [itens, setItens] = useState<ItemSolicitacaoDevolucao[]>([]);
  const [pedidoReferencia, setPedidoReferencia] = useState("");
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [itensForm, setItensForm] = useState<ItemForm[]>([{ ...ITEM_INICIAL }]);
  const [produtoBuscaAberta, setProdutoBuscaAberta] = useState<number | null>(null);
  const [quantidadesConfirmadas, setQuantidadesConfirmadas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [formSolicitacaoOpen, setFormSolicitacaoOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const podeSolicitarDevolucao = Boolean(usuario?.podeSolicitarDevolucao);

  const itensPorSolicitacao = useMemo(() => {
    return itens.reduce<Record<string, ItemSolicitacaoDevolucao[]>>((acc, item) => {
      acc[item.solicitacao_id] = [...(acc[item.solicitacao_id] ?? []), item];
      return acc;
    }, {});
  }, [itens]);

  async function carregarDados() {
    setLoading(true);
    setMessage(null);

    const produtosResp = await supabase.from("produtos").select("id, sku, imagem_url").eq("ativo", true).order("sku");

    if (produtosResp.error) {
      setMessage(`Erro ao carregar produtos: ${produtosResp.error.message}`);
      setLoading(false);
      return;
    }

    setProdutos((produtosResp.data as Produto[]) ?? []);

    const [solicitacoesResp, itensResp] = await Promise.all([
      supabase
        .from("solicitacoes_devolucao")
        .select("id, status, pedido_referencia, observacao_geral, created_at, confirmada_em")
        .order("created_at", { ascending: false }),
      supabase
        .from("itens_solicitacao_devolucao")
        .select(
          "id, solicitacao_id, produto_id, sku, imagem_url, quantidade_solicitada, quantidade_confirmada, observacao, status_item",
        )
        .order("created_at", { ascending: true }),
    ]);

    if (solicitacoesResp.error || itensResp.error) {
      setMessage(solicitacoesResp.error?.message ?? itensResp.error?.message ?? "Erro ao carregar devoluções.");
      setLoading(false);
      return;
    }

    const listaItens = (itensResp.data as ItemSolicitacaoDevolucao[]) ?? [];
    const iniciais: Record<string, string> = {};

    listaItens.forEach((item) => {
      iniciais[item.id] = String(item.quantidade_confirmada || item.quantidade_solicitada);
    });

    setSolicitacoes((solicitacoesResp.data as SolicitacaoDevolucao[]) ?? []);
    setItens(listaItens);
    setQuantidadesConfirmadas(iniciais);
    setLoading(false);
  }

  useEffect(() => {
    carregarDados();
  }, []);

  function alterarItem(index: number, patch: Partial<ItemForm>) {
    if (!podeSolicitarDevolucao) return;

    setItensForm((anterior) => anterior.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function produtosFiltrados(busca: string) {
    const termo = busca.trim().toLowerCase();
    const lista = termo ? produtos.filter((produto) => produto.sku.toLowerCase().includes(termo)) : produtos;

    return lista.slice(0, 12);
  }

  function alterarProdutoBusca(index: number, valor: string) {
    if (!podeSolicitarDevolucao) return;

    const produto = produtos.find((item) => item.sku.toLowerCase() === valor.trim().toLowerCase());

    alterarItem(index, {
      produto_busca: valor,
      produto_id: produto?.id ?? "",
    });
    setProdutoBuscaAberta(index);
  }

  function selecionarProduto(index: number, produto: Produto) {
    if (!podeSolicitarDevolucao) return;

    alterarItem(index, {
      produto_id: produto.id,
      produto_busca: produto.sku,
    });
    setProdutoBuscaAberta(null);
  }

  function adicionarItem() {
    if (!podeSolicitarDevolucao) return;

    setFormSolicitacaoOpen(true);
    setItensForm((anterior) => [...anterior, { ...ITEM_INICIAL }]);
  }

  function removerItem(index: number) {
    if (!podeSolicitarDevolucao) return;

    setItensForm((anterior) => (anterior.length > 1 ? anterior.filter((_, i) => i !== index) : anterior));
  }

  function limparFormulario() {
    setPedidoReferencia("");
    setObservacaoGeral("");
    setItensForm([{ ...ITEM_INICIAL }]);
    setFormSolicitacaoOpen(false);
  }

  async function criarSolicitacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeSolicitarDevolucao) return;

    setSaving(true);
    setMessage(null);

    const itensNormalizados = itensForm.map((item) => ({
      ...item,
      quantidade: Number(item.quantidade_solicitada),
    }));
    const itemInvalido = itensNormalizados.find((item) => !item.produto_id || Number.isNaN(item.quantidade) || item.quantidade <= 0);

    if (itemInvalido) {
      setMessage("Preencha produto e quantidade valida para todos os itens.");
      setSaving(false);
      return;
    }

    const { data: solicitacaoCriada, error: solicitacaoErro } = await supabase
      .from("solicitacoes_devolucao")
      .insert({
        status: "pendente",
        pedido_referencia: pedidoReferencia.trim() || null,
        observacao_geral: observacaoGeral.trim() || null,
      })
      .select("id")
      .single();

    if (solicitacaoErro || !solicitacaoCriada) {
      setMessage(`Erro ao criar solicitacao de devolucao: ${solicitacaoErro?.message ?? "erro desconhecido"}`);
      setSaving(false);
      return;
    }

    const itensPayload = itensNormalizados.map((item) => {
      const produto = produtos.find((p) => p.id === item.produto_id);

      return {
        solicitacao_id: solicitacaoCriada.id,
        produto_id: item.produto_id,
        sku: produto?.sku ?? "",
        imagem_url: produto?.imagem_url ?? null,
        quantidade_solicitada: item.quantidade,
        quantidade_confirmada: 0,
        observacao: item.observacao.trim() || null,
        status_item: "pendente",
      };
    });

    const { error: itensErro } = await supabase.from("itens_solicitacao_devolucao").insert(itensPayload);

    if (itensErro) {
      setMessage(`Solicitacao criada, mas erro ao criar itens: ${itensErro.message}`);
      setSaving(false);
      return;
    }

    limparFormulario();
    await carregarDados();
    setSaving(false);
  }

  async function confirmarChegada(solicitacao: SolicitacaoDevolucao) {
    if (!podeSolicitarDevolucao) return;

    const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];
    if (itensSolicitacao.length === 0) return;

    setConfirmandoId(solicitacao.id);
    setMessage(null);

    for (const item of itensSolicitacao) {
      const quantidade = Number(quantidadesConfirmadas[item.id]);

      if (Number.isNaN(quantidade) || quantidade < 0) {
        setMessage(`Informe uma quantidade valida para ${item.sku}.`);
        setConfirmandoId(null);
        return;
      }

      const { error: itemErro } = await supabase
        .from("itens_solicitacao_devolucao")
        .update({
          quantidade_confirmada: quantidade,
          status_item: "concluido",
        })
        .eq("id", item.id);

      if (itemErro) {
        setMessage(`Erro ao confirmar item ${item.sku}: ${itemErro.message}`);
        setConfirmandoId(null);
        return;
      }

      if (quantidade > 0) {
        const { error: movimentoErro } = await supabase.from("movimentacoes_estoque").insert({
          produto_id: item.produto_id,
          sku: item.sku,
          tipo_movimento: "entrada",
          quantidade,
          origem: "DEVOLUCAO",
          referencia_id: solicitacao.id,
          observacao: `Entrada por devolucao${solicitacao.pedido_referencia ? ` - ${solicitacao.pedido_referencia}` : ""}`,
        });

        if (movimentoErro) {
          setMessage(`Erro ao criar entrada de estoque para ${item.sku}: ${movimentoErro.message}`);
          setConfirmandoId(null);
          return;
        }
      }
    }

    const { error: solicitacaoErro } = await supabase
      .from("solicitacoes_devolucao")
      .update({
        status: "concluida",
        confirmada_em: new Date().toISOString(),
      })
      .eq("id", solicitacao.id);

    if (solicitacaoErro) {
      setMessage(`Erro ao concluir devolucao: ${solicitacaoErro.message}`);
      setConfirmandoId(null);
      return;
    }

    setMessage("Devolucao confirmada e estoque atualizado.");
    await carregarDados();
    setConfirmandoId(null);
  }

  return (
    <AccessGuard permissions={["podeVisualizarDevolucao", "podeSolicitarDevolucao"]}>
      <div className="space-y-8">
      <PageHeader
        title="Devoluções"
        description="Crie solicitações de devolução e confirme a chegada para devolver os itens ao estoque."
      />

      {podeSolicitarDevolucao && (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">Nova solicitação de devolução</h3>
          <button
            type="button"
            onClick={() => setFormSolicitacaoOpen((prev) => !prev)}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
            aria-expanded={formSolicitacaoOpen}
          >
            {formSolicitacaoOpen ? "Fechar" : "Abrir"}
          </button>
        </div>

        {formSolicitacaoOpen && (
        <form className="mt-4 space-y-4" onSubmit={criarSolicitacao}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Pedido ou referência
              <input
                value={pedidoReferencia}
                onChange={(event) => setPedidoReferencia(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Ex.: pedido Olist, cliente, NF..."
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
                      {produtos.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-500">Nenhum produto carregado</div>
                      ) : produtosFiltrados(item.produto_busca).length > 0 ? (
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
                        <div className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado</div>
                      )}
                    </div>
                  )}
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

                <label className="text-sm text-slate-700 md:col-span-2">
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
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remover item
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={adicionarItem}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              <Plus className="h-4 w-4" />
              Adicionar item
            </button>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Criar solicitação"}
          </button>
        </form>
        )}

        {message && <p className="mt-4 text-sm text-slate-700">{message}</p>}
      </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Solicitações de devolução</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando devoluções...</p>
        ) : solicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhuma solicitação de devolução criada.</p>
        ) : (
          <div className="space-y-4">
            {solicitacoes.map((solicitacao) => {
              const itensSolicitacao = itensPorSolicitacao[solicitacao.id] ?? [];
              const pendente = solicitacao.status === "pendente";
              const confirmando = confirmandoId === solicitacao.id;

              return (
                <div key={solicitacao.id} className="rounded-md border border-slate-200 p-4">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1 text-sm text-slate-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-slate-900">
                          {solicitacao.pedido_referencia || "Devolução sem referência"}
                        </h4>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {formatarStatus(solicitacao.status)}
                        </span>
                      </div>
                      <p>Criada em: {new Date(solicitacao.created_at).toLocaleString("pt-BR")}</p>
                      {solicitacao.confirmada_em && (
                        <p>Confirmada em: {new Date(solicitacao.confirmada_em).toLocaleString("pt-BR")}</p>
                      )}
                      <p>Observação: {solicitacao.observacao_geral || "-"}</p>
                    </div>

                    {pendente && podeSolicitarDevolucao && (
                      <button
                        type="button"
                        onClick={() => confirmarChegada(solicitacao)}
                        disabled={confirmandoId !== null || itensSolicitacao.length === 0}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {confirmando ? "Confirmando..." : "Confirmar chegada"}
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                          <th className="p-3">Imagem</th>
                          <th className="p-3">SKU</th>
                          <th className="p-3">Qtd. solicitada</th>
                          <th className="p-3">Qtd. chegada</th>
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
                              {pendente && podeSolicitarDevolucao ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={quantidadesConfirmadas[item.id] ?? String(item.quantidade_solicitada)}
                                  onChange={(event) =>
                                    setQuantidadesConfirmadas((prev) => ({
                                      ...prev,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  className="w-28 rounded-md border border-slate-300 px-2 py-1"
                                />
                              ) : (
                                <span className="text-slate-700">{item.quantidade_confirmada}</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-700">{item.observacao || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </AccessGuard>
  );
}
