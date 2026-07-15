"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";
import { supabase } from "@/lib/supabase";

type FornecedorOption = {
  id: string;
  nome: string;
};

type ProdutoFornecedor = {
  id: string;
  fornecedor_id: string;
  nome: string;
  descricao: string | null;
  referencia: string | null;
  preco_unitario_metro: number | string;
  peso_liquido_metro: number | string | null;
  peso_bruto_metro: number | string | null;
  largura_embalagem_metro: number | string | null;
  altura_embalagem_metro: number | string | null;
  comprimento_embalagem_metro: number | string | null;
  created_at: string;
  fornecedores: {
    nome: string;
  } | null;
};

type ProdutoFornecedorRow = Omit<ProdutoFornecedor, "fornecedores"> & {
  fornecedores:
    | {
        nome: string;
      }
    | {
        nome: string;
      }[]
    | null;
};

type ProdutoFornecedorFormData = {
  fornecedor_id: string;
  nome: string;
  descricao: string;
  referencia: string;
  preco_unitario_metro: string;
  peso_liquido_metro: string;
  peso_bruto_metro: string;
  largura_embalagem_metro: string;
  altura_embalagem_metro: string;
  comprimento_embalagem_metro: string;
};

const INITIAL_FORM: ProdutoFornecedorFormData = {
  fornecedor_id: "",
  nome: "",
  descricao: "",
  referencia: "",
  preco_unitario_metro: "",
  peso_liquido_metro: "",
  peso_bruto_metro: "",
  largura_embalagem_metro: "",
  altura_embalagem_metro: "",
  comprimento_embalagem_metro: "",
};

function normalizarNumero(valor: string) {
  const trimmed = valor.trim();
  const normalizado = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;

  if (!normalizado) return null;

  return Number(normalizado);
}

function formatarNumeroParaInput(valor: number | string | null, casas: number) {
  if (valor === null) return "";

  const numero = Number(valor);

  if (Number.isNaN(numero)) return String(valor);

  return numero.toFixed(casas).replace(".", ",");
}

function formatarPreco(valor: number | string) {
  const numero = Number(valor);

  if (Number.isNaN(numero)) return "-";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(numero);
}

function formatarDecimal(valor: number | string | null, casas = 2) {
  if (valor === null) return "-";

  const numero = Number(valor);

  if (Number.isNaN(numero)) return "-";

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(numero);
}

function normalizarProdutoFornecedor(row: ProdutoFornecedorRow): ProdutoFornecedor {
  const fornecedor = Array.isArray(row.fornecedores)
    ? (row.fornecedores[0] ?? null)
    : row.fornecedores;

  return {
    ...row,
    fornecedores: fornecedor,
  };
}

export default function ProdutosFornecedorPage() {
  const [fornecedores, setFornecedores] = useState<FornecedorOption[]>([]);
  const [produtos, setProdutos] = useState<ProdutoFornecedor[]>([]);
  const [formData, setFormData] =
    useState<ProdutoFornecedorFormData>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isEditing = useMemo(() => editingId !== null, [editingId]);

  async function carregarDados() {
    setIsLoading(true);
    setErrorMessage(null);

    const [
      { data: fornecedoresData, error: fornecedoresError },
      { data: produtosData, error: produtosError },
    ] = await Promise.all([
      supabase
        .from("fornecedores")
        .select("id, nome")
        .order("nome", { ascending: true }),
      supabase
        .from("produtos_fornecedor")
        .select(
          "id, fornecedor_id, nome, descricao, referencia, preco_unitario_metro, peso_liquido_metro, peso_bruto_metro, largura_embalagem_metro, altura_embalagem_metro, comprimento_embalagem_metro, created_at, fornecedores(nome)",
        )
        .order("created_at", { ascending: false }),
    ]);

    if (fornecedoresError || produtosError) {
      setErrorMessage(
        fornecedoresError?.message ??
          produtosError?.message ??
          "Erro ao carregar produtos de fornecedores.",
      );
      setIsLoading(false);
      return;
    }

    setFornecedores((fornecedoresData as FornecedorOption[]) ?? []);
    setProdutos(((produtosData as ProdutoFornecedorRow[]) ?? []).map(normalizarProdutoFornecedor));
    setIsLoading(false);
  }

  useEffect(() => {
    carregarDados();
  }, []);

  function resetForm() {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setFormOpen(false);
  }

  function handleEdit(produto: ProdutoFornecedor) {
    setEditingId(produto.id);
    setFormOpen(true);
    setFormData({
      fornecedor_id: produto.fornecedor_id,
      nome: produto.nome,
      descricao: produto.descricao ?? "",
      referencia: produto.referencia ?? "",
      preco_unitario_metro: formatarNumeroParaInput(produto.preco_unitario_metro, 2),
      peso_liquido_metro: formatarNumeroParaInput(produto.peso_liquido_metro, 3),
      peso_bruto_metro: formatarNumeroParaInput(produto.peso_bruto_metro, 3),
      largura_embalagem_metro: formatarNumeroParaInput(produto.largura_embalagem_metro, 2),
      altura_embalagem_metro: formatarNumeroParaInput(produto.altura_embalagem_metro, 2),
      comprimento_embalagem_metro: formatarNumeroParaInput(produto.comprimento_embalagem_metro, 2),
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const preco = normalizarNumero(formData.preco_unitario_metro);
    const pesoLiquido = normalizarNumero(formData.peso_liquido_metro);
    const pesoBruto = normalizarNumero(formData.peso_bruto_metro);
    const larguraEmbalagem = normalizarNumero(formData.largura_embalagem_metro);
    const alturaEmbalagem = normalizarNumero(formData.altura_embalagem_metro);
    const comprimentoEmbalagem = normalizarNumero(formData.comprimento_embalagem_metro);
    const payload = {
      fornecedor_id: formData.fornecedor_id,
      nome: formData.nome.trim(),
      descricao: formData.descricao.trim() || null,
      referencia: formData.referencia.trim() || null,
      preco_unitario_metro: preco,
      peso_liquido_metro: pesoLiquido,
      peso_bruto_metro: pesoBruto,
      largura_embalagem_metro: larguraEmbalagem,
      altura_embalagem_metro: alturaEmbalagem,
      comprimento_embalagem_metro: comprimentoEmbalagem,
      updated_at: new Date().toISOString(),
    };

    const numerosInvalidos = [
      preco,
      pesoLiquido,
      pesoBruto,
      larguraEmbalagem,
      alturaEmbalagem,
      comprimentoEmbalagem,
    ].some((valor) => valor !== null && (Number.isNaN(valor) || valor < 0));

    if (!payload.fornecedor_id || !payload.nome || preco === null || Number.isNaN(preco) || preco <= 0) {
      setErrorMessage("Preencha fornecedor, nome e preco validos.");
      setIsSaving(false);
      return;
    }

    if (numerosInvalidos) {
      setErrorMessage("Preencha pesos e medidas por metro com numeros validos maiores ou iguais a zero.");
      setIsSaving(false);
      return;
    }

    const query = isEditing
      ? supabase.from("produtos_fornecedor").update(payload).eq("id", editingId)
      : supabase.from("produtos_fornecedor").insert(payload);

    const { error } = await query;

    if (error) {
      setErrorMessage(`Erro ao salvar produto: ${error.message}`);
      setIsSaving(false);
      return;
    }

    await carregarDados();
    resetForm();
    setSuccessMessage(
      isEditing
        ? "Produto atualizado com sucesso."
        : "Produto cadastrado com sucesso.",
    );
    setIsSaving(false);
  }

  async function handleDelete(produto: ProdutoFornecedor) {
    const confirmar = window.confirm(`Excluir produto ${produto.nome}?`);

    if (!confirmar) return;

    setDeletingId(produto.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase
      .from("produtos_fornecedor")
      .delete()
      .eq("id", produto.id);

    if (error) {
      setErrorMessage(`Erro ao excluir produto: ${error.message}`);
      setDeletingId(null);
      return;
    }

    if (editingId === produto.id) {
      resetForm();
    }

    await carregarDados();
    setSuccessMessage("Produto excluido com sucesso.");
    setDeletingId(null);
  }

  return (
    <AccessGuard permissions={["podeVisualizarProdutosFornecedor"]}>
    <div className="space-y-8">
      <PageHeader
        title="Produtos do fornecedor"
        description="Organize produtos, referencias e precos de cada fornecedor."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {isEditing ? "Editar produto" : "Cadastrar produto"}
          </h3>
          <button
            type="button"
            onClick={() => {
              if (formOpen) {
                resetForm();
                return;
              }

              setFormOpen(true);
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
            aria-expanded={formOpen}
          >
            {formOpen ? "Fechar" : "Abrir"}
          </button>
        </div>

        {formOpen && (
        <form className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-sm text-slate-700">
            Fornecedor
            <select
              required
              value={formData.fornecedor_id}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  fornecedor_id: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Selecione um fornecedor</option>
              {fornecedores.map((fornecedor) => (
                <option key={fornecedor.id} value={fornecedor.id}>
                  {fornecedor.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Nome
            <input
              required
              value={formData.nome}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, nome: event.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Nome do produto"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Descricao
            <textarea
              value={formData.descricao}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  descricao: event.target.value,
                }))
              }
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Detalhes do produto"
            />
          </label>

          <label className="text-sm text-slate-700">
            Referencia
            <input
              value={formData.referencia}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  referencia: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Codigo ou referencia do fornecedor"
            />
          </label>

          <label className="text-sm text-slate-700">
            Preco unitario / metro
            <input
              required
              inputMode="decimal"
              value={formData.preco_unitario_metro}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  preco_unitario_metro: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: 12,50"
            />
          </label>

          {[
            { key: "peso_liquido_metro", label: "Peso liquido / metro", placeholder: "0,000" },
            { key: "peso_bruto_metro", label: "Peso bruto / metro", placeholder: "0,000" },
            { key: "largura_embalagem_metro", label: "Largura da embalagem / metro", placeholder: "0,00" },
            { key: "altura_embalagem_metro", label: "Altura da embalagem / metro", placeholder: "0,00" },
            { key: "comprimento_embalagem_metro", label: "Comprimento da embalagem / metro", placeholder: "0,00" },
          ].map((field) => (
            <label key={field.key} className="text-sm text-slate-700">
              {field.label}
              <input
                inputMode="decimal"
                value={formData[field.key as keyof ProdutoFornecedorFormData]}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    [field.key]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder={field.placeholder}
              />
            </label>
          ))}

          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={isSaving || fornecedores.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving
                ? "Salvando..."
                : isEditing
                  ? "Salvar edicao"
                  : "Cadastrar"}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>
        )}

        {fornecedores.length === 0 && !isLoading && (
          <p className="mt-4 text-sm text-amber-700">
            Cadastre um fornecedor antes de adicionar produtos.
          </p>
        )}
        {errorMessage && (
          <p className="mt-4 text-sm text-red-600">{errorMessage}</p>
        )}
        {successMessage && (
          <p className="mt-4 text-sm text-emerald-700">{successMessage}</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Produtos cadastrados
        </h3>

        {isLoading ? (
          <p className="text-sm text-slate-600">Carregando produtos...</p>
        ) : produtos.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum produto cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">ID</th>
                  <th className="p-3">Fornecedor</th>
                  <th className="p-3">Nome</th>
                  <th className="p-3">Referencia</th>
                  <th className="p-3">Preco unitario / metro</th>
                  <th className="p-3">Pesos / metro</th>
                  <th className="p-3">Embalagem / metro</th>
                  <th className="p-3">Descricao</th>
                  <th className="p-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((produto) => (
                  <tr key={produto.id} className="border-b border-slate-100">
                    <td className="max-w-48 break-all p-3 font-mono text-xs text-slate-600">
                      {produto.id}
                    </td>
                    <td className="p-3 text-slate-700">
                      {produto.fornecedores?.nome ?? "-"}
                    </td>
                    <td className="p-3 font-medium text-slate-700">
                      {produto.nome}
                    </td>
                    <td className="p-3 text-slate-700">
                      {produto.referencia || "-"}
                    </td>
                    <td className="p-3 font-semibold text-slate-900">
                      {formatarPreco(produto.preco_unitario_metro)}
                    </td>
                    <td className="p-3 text-slate-700">
                      <span className="block">Liquido: {formatarDecimal(produto.peso_liquido_metro, 3)}</span>
                      <span className="block text-xs text-slate-500">
                        Bruto: {formatarDecimal(produto.peso_bruto_metro, 3)}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700">
                      {[
                        formatarDecimal(produto.largura_embalagem_metro),
                        formatarDecimal(produto.altura_embalagem_metro),
                        formatarDecimal(produto.comprimento_embalagem_metro),
                      ].join(" x ")}
                    </td>
                    <td className="max-w-md p-3 text-slate-700">
                      {produto.descricao || "-"}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(produto)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(produto)}
                          disabled={deletingId === produto.id}
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === produto.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
    </AccessGuard>
  );
}
