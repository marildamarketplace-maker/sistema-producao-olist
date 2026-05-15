"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Solicitacao = {
  id: string;
  data_entrega: string;
  status: string;
  created_at: string;
};

type ItemSolicitacao = {
  id: string;
  solicitacao_id: string;
  produto_id: string;
  sku: string;
  nome: string;
  imagem_url: string | null;
  quantidade_solicitada: number;
  quantidade_produzida: number;
  observacao: string | null;
};

export default function ConfirmarProducaoPage() {
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [itens, setItens] = useState<ItemSolicitacao[]>([]);
  const [produzidas, setProduzidas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const solicitacaoSelecionada = useMemo(
    () => solicitacoes.find((s) => s.id === selectedId) ?? null,
    [selectedId, solicitacoes],
  );

  async function carregarSolicitacoes() {
    const { data, error } = await supabase
      .from("solicitacoes_producao")
      .select("id, data_entrega, status, created_at")
      .eq("status", "em_producao")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Erro ao carregar solicitações: ${error.message}`);
      return;
    }

    const lista = (data as Solicitacao[]) ?? [];
    setSolicitacoes(lista);

    if (!selectedId && lista.length > 0) {
      setSelectedId(lista[0].id);
    }

    if (lista.length === 0) {
      setSelectedId("");
      setItens([]);
      setProduzidas({});
    }
  }

  async function carregarItens(solicitacaoId: string) {
    const { data, error } = await supabase
      .from("itens_solicitacao_producao")
      .select(
        "id, solicitacao_id, produto_id, sku, nome, imagem_url, quantidade_solicitada, quantidade_produzida, observacao",
      )
      .eq("solicitacao_id", solicitacaoId)
      .order("created_at", { ascending: true });

    if (error) {
      setMessage(`Erro ao carregar itens: ${error.message}`);
      return;
    }

    const listaItens = (data as ItemSolicitacao[]) ?? [];
    setItens(listaItens);
    const inicial: Record<string, string> = {};
    listaItens.forEach((item) => {
      inicial[item.id] = String(item.quantidade_produzida ?? 0);
    });
    setProduzidas(inicial);
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setMessage(null);
      await carregarSolicitacoes();
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessage(null);
    carregarItens(selectedId);
  }, [selectedId]);

  async function confirmarProducao() {
    if (!solicitacaoSelecionada) return;

    setSaving(true);
    setMessage(null);

    const atualizacoes = itens.map((item) => {
      const qtd = Number(produzidas[item.id]);
      return { item, qtd };
    });

    const invalido = atualizacoes.find(({ qtd }) => Number.isNaN(qtd) || qtd < 0);
    if (invalido) {
      setMessage("Informe quantidades produzidas válidas (>= 0).");
      setSaving(false);
      return;
    }

    for (const { item, qtd } of atualizacoes) {
      const { error: updateError } = await supabase
        .from("itens_solicitacao_producao")
        .update({ quantidade_produzida: qtd })
        .eq("id", item.id);

      if (updateError) {
        setMessage(`Erro ao atualizar item ${item.sku}: ${updateError.message}`);
        setSaving(false);
        return;
      }

      if (qtd > 0) {
        const { error: movError } = await supabase.from("movimentacoes_estoque").insert({
          produto_id: item.produto_id,
          sku: item.sku,
          tipo_movimento: "entrada",
          quantidade: qtd,
          origem: "PRODUCAO",
          referencia_id: solicitacaoSelecionada.id,
          observacao: "Entrada por confirmação de produção",
        });

        if (movError) {
          setMessage(`Erro ao criar movimentação de ${item.sku}: ${movError.message}`);
          setSaving(false);
          return;
        }
      }
    }

    const { error: statusError } = await supabase
      .from("solicitacoes_producao")
      .update({ status: "concluida" })
      .eq("id", solicitacaoSelecionada.id);

    if (statusError) {
      setMessage(`Erro ao concluir solicitação: ${statusError.message}`);
      setSaving(false);
      return;
    }

    setMessage("Solicitação confirmada com sucesso.");
    await carregarSolicitacoes();
    if (selectedId) {
      const aindaExiste = solicitacoes.some((s) => s.id === selectedId);
      if (!aindaExiste) {
        setSelectedId("");
      }
    }
    setSaving(false);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Confirmar Produção"
        description="Confirme quantidades produzidas e gere entradas de estoque por solicitação."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Solicitações EM_PRODUCAO</h3>

        {loading ? (
          <p className="text-sm text-slate-600">Carregando solicitações...</p>
        ) : solicitacoes.length === 0 ? (
          <p className="text-sm text-slate-600">Não há solicitações com status EM_PRODUCAO.</p>
        ) : (
          <label className="block text-sm text-slate-700">
            Selecione a solicitação
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {solicitacoes.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(`${s.data_entrega}T00:00:00`).toLocaleDateString("pt-BR")} • {new Date(s.created_at).toLocaleString("pt-BR")}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {selectedId && itens.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">Itens da solicitação</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Imagem</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Nome</th>
                  <th className="p-3">Qtd. solicitada</th>
                  <th className="p-3">Qtd. produzida</th>
                  <th className="p-3">Observação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="p-3">
                      {item.imagem_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imagem_url} alt={item.nome} className="h-12 w-12 rounded object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">Sem imagem</div>
                      )}
                    </td>
                    <td className="p-3 font-medium text-slate-700">{item.sku}</td>
                    <td className="p-3 text-slate-700">{item.nome}</td>
                    <td className="p-3 text-slate-700">{item.quantidade_solicitada}</td>
                    <td className="p-3">
                      <input
                        type="number"
                        min={0}
                        value={produzidas[item.id] ?? "0"}
                        onChange={(event) =>
                          setProduzidas((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="w-28 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="p-3 text-slate-700">{item.observacao || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <button
              onClick={confirmarProducao}
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Confirmando..." : "Confirmar produção"}
            </button>
          </div>

          {message && <p className="mt-3 text-sm text-slate-700">{message}</p>}
        </section>
      )}
    </div>
  );
}
