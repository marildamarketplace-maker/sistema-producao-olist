"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/lib/supabase";

type Produto = {
  id: string;
  sku: string;
  imagem_url: string | null;
  meta_estoque: number | null;
  minimo_estoque: number | null;
  ativo: boolean;
  created_at: string;
};

type FormData = {
  sku: string;
  imagem_url: string;
  meta_estoque: string;
  minimo_estoque: string;
  ativo: boolean;
};

const INITIAL_FORM: FormData = {
  sku: "",
  imagem_url: "",
  meta_estoque: "",
  minimo_estoque: "",
  ativo: true,
};

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEditing = useMemo(() => editingId !== null, [editingId]);

  async function loadProdutos() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("produtos")
      .select("id, sku, imagem_url, meta_estoque, minimo_estoque, ativo, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(`Erro ao carregar produtos: ${error.message}`);
      setIsLoading(false);
      return;
    }

    setProdutos((data as Produto[]) ?? []);
    setIsLoading(false);
  }

  useEffect(() => {
    loadProdutos();
  }, []);

  function resetForm() {
    setFormData(INITIAL_FORM);
    setEditingId(null);
  }

  function handleEdit(produto: Produto) {
    setEditingId(produto.id);
    setFormData({
      sku: produto.sku,
      imagem_url: produto.imagem_url ?? "",
      meta_estoque: produto.meta_estoque === null ? "" : String(produto.meta_estoque),
      minimo_estoque: produto.minimo_estoque === null ? "" : String(produto.minimo_estoque),
      ativo: produto.ativo,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);

    const payload = {
      sku: formData.sku.trim(),
      imagem_url: formData.imagem_url.trim() || null,
      meta_estoque: formData.meta_estoque === "" ? null : Number(formData.meta_estoque),
      minimo_estoque: formData.minimo_estoque === "" ? null : Number(formData.minimo_estoque),
      ativo: formData.ativo,
    };

    if (
      !payload.sku ||
      (payload.meta_estoque !== null &&
        (Number.isNaN(payload.meta_estoque) || payload.meta_estoque < 0)) ||
      (payload.minimo_estoque !== null &&
        (Number.isNaN(payload.minimo_estoque) || payload.minimo_estoque < 0))
    ) {
      setErrorMessage("Preencha SKU, meta e minimo de estoque validos.");
      setIsSaving(false);
      return;
    }

    const query = isEditing
      ? supabase.from("produtos").update(payload).eq("id", editingId)
      : supabase.from("produtos").insert(payload);

    const { error } = await query;

    if (error) {
      setErrorMessage(`Erro ao salvar produto: ${error.message}`);
      setIsSaving(false);
      return;
    }

    await loadProdutos();
    resetForm();
    setIsSaving(false);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Produtos"
        description="Cadastre, edite e acompanhe os produtos têxteis para produção e estoque."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          {isEditing ? "Editar produto" : "Cadastrar produto"}
        </h3>

        <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="text-sm text-slate-700">
            SKU
            <input
              required
              value={formData.sku}
              onChange={(event) => setFormData((prev) => ({ ...prev, sku: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Ex.: CAM-001"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            URL da imagem
            <input
              type="url"
              value={formData.imagem_url}
              onChange={(event) => setFormData((prev) => ({ ...prev, imagem_url: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="https://..."
            />
          </label>

          <label className="text-sm text-slate-700">
            Meta de estoque
            <input
              type="number"
              min={0}
              value={formData.meta_estoque}
              onChange={(event) => setFormData((prev) => ({ ...prev, meta_estoque: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Minimo de estoque
            <input
              type="number"
              min={0}
              value={formData.minimo_estoque}
              onChange={(event) => setFormData((prev) => ({ ...prev, minimo_estoque: event.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={formData.ativo}
              onChange={(event) => setFormData((prev) => ({ ...prev, ativo: event.target.checked }))}
            />
            Produto ativo
          </label>

          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : isEditing ? "Salvar edição" : "Cadastrar"}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
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
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Listagem de produtos</h3>

        {isLoading ? (
          <p className="text-sm text-slate-600">Carregando produtos...</p>
        ) : produtos.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum produto cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Imagem</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Meta de estoque</th>
                  <th className="p-3">Minimo de estoque</th>
                  <th className="p-3">Ativo</th>
                  <th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((produto) => (
                  <tr key={produto.id} className="border-b border-slate-100">
                    <td className="p-3">
                      {produto.imagem_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={produto.imagem_url}
                          alt={produto.sku}
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">
                          Sem imagem
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-medium text-slate-700">{produto.sku}</td>
                    <td className="p-3 text-slate-700">{produto.meta_estoque ?? "(meta geral)"}</td>
                    <td className="p-3 text-slate-700">{produto.minimo_estoque ?? "(minimo geral)"}</td>
                    <td className="p-3 text-slate-700">{produto.ativo ? "Sim" : "Não"}</td>
                    <td className="p-3">
                      <button
                        onClick={() => handleEdit(produto)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
