"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";
import { supabase } from "@/lib/supabase";

type Fornecedor = {
  id: string;
  nome: string;
  endereco: string | null;
  created_at: string;
  updated_at: string;
};

type FornecedorFormData = {
  nome: string;
  endereco: string;
};

const INITIAL_FORM: FornecedorFormData = {
  nome: "",
  endereco: "",
};

export default function FornecedoresPage() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [formData, setFormData] = useState<FornecedorFormData>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isEditing = useMemo(() => editingId !== null, [editingId]);

  async function carregarFornecedores() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("fornecedores")
      .select("id, nome, endereco, created_at, updated_at")
      .order("nome", { ascending: true });

    if (error) {
      setErrorMessage(`Erro ao carregar fornecedores: ${error.message}`);
      setIsLoading(false);
      return;
    }

    setFornecedores((data as Fornecedor[]) ?? []);
    setIsLoading(false);
  }

  useEffect(() => {
    carregarFornecedores();
  }, []);

  function resetForm() {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setFormOpen(false);
  }

  function handleEdit(fornecedor: Fornecedor) {
    setEditingId(fornecedor.id);
    setFormOpen(true);
    setFormData({
      nome: fornecedor.nome,
      endereco: fornecedor.endereco ?? "",
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload = {
      nome: formData.nome.trim(),
      endereco: formData.endereco.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (!payload.nome) {
      setErrorMessage("Nome do fornecedor e obrigatorio.");
      setIsSaving(false);
      return;
    }

    const query = isEditing
      ? supabase.from("fornecedores").update(payload).eq("id", editingId)
      : supabase.from("fornecedores").insert(payload);

    const { error } = await query;

    if (error) {
      setErrorMessage(`Erro ao salvar fornecedor: ${error.message}`);
      setIsSaving(false);
      return;
    }

    await carregarFornecedores();
    resetForm();
    setSuccessMessage(
      isEditing
        ? "Fornecedor atualizado com sucesso."
        : "Fornecedor cadastrado com sucesso.",
    );
    setIsSaving(false);
  }

  async function handleDelete(fornecedor: Fornecedor) {
    const confirmar = window.confirm(`Excluir fornecedor ${fornecedor.nome}?`);

    if (!confirmar) return;

    setDeletingId(fornecedor.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    const { error } = await supabase
      .from("fornecedores")
      .delete()
      .eq("id", fornecedor.id);

    if (error) {
      setErrorMessage(`Erro ao excluir fornecedor: ${error.message}`);
      setDeletingId(null);
      return;
    }

    if (editingId === fornecedor.id) {
      resetForm();
    }

    await carregarFornecedores();
    setSuccessMessage("Fornecedor excluido com sucesso.");
    setDeletingId(null);
  }

  return (
    <AccessGuard permissions={["podeVisualizarFornecedores"]}>
    <div className="space-y-8">
      <PageHeader
        title="Fornecedores"
        description="Cadastre e acompanhe fornecedores usados pelo sistema."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {isEditing ? "Editar fornecedor" : "Cadastrar fornecedor"}
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
            Nome
            <input
              required
              value={formData.nome}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, nome: event.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Nome do fornecedor"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Endereco
            <textarea
              value={formData.endereco}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  endereco: event.target.value,
                }))
              }
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="Rua, numero, bairro, cidade..."
            />
          </label>

          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
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

        {errorMessage && (
          <p className="mt-4 text-sm text-red-600">{errorMessage}</p>
        )}
        {successMessage && (
          <p className="mt-4 text-sm text-emerald-700">{successMessage}</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Fornecedores cadastrados
        </h3>

        {isLoading ? (
          <p className="text-sm text-slate-600">Carregando fornecedores...</p>
        ) : fornecedores.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nenhum fornecedor cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="p-3">Nome</th>
                  <th className="p-3">Endereco</th>
                  <th className="p-3">Cadastro</th>
                  <th className="p-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map((fornecedor) => (
                  <tr key={fornecedor.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-700">
                      {fornecedor.nome}
                    </td>
                    <td className="max-w-md p-3 text-slate-700">
                      {fornecedor.endereco || "-"}
                    </td>
                    <td className="p-3 text-slate-700">
                      {new Date(fornecedor.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(fornecedor)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(fornecedor)}
                          disabled={deletingId === fornecedor.id}
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === fornecedor.id ? "Excluindo..." : "Excluir"}
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
