"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AccessGuard } from "@/components/access-guard";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

type AplicativoPaiOption = { id: string; nome: string };

type Fornecedor = {
  id: string;
  aplicativo_pai_id: string;
  nome: string;
  endereco: string | null;
  created_at: string;
  ativo: boolean;
};

type FornecedorFormData = {
  aplicativo_pai_id: string;
  nome: string;
  endereco: string;
};

const INITIAL_FORM: FornecedorFormData = {
  aplicativo_pai_id: "",
  nome: "",
  endereco: "",
};

export default function FornecedoresPage() {
  const { session, usuario } = useAuth();
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [aplicativosPai, setAplicativosPai] = useState<AplicativoPaiOption[]>([]);
  const [formData, setFormData] = useState<FornecedorFormData>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mostrarEncerrados, setMostrarEncerrados] = useState(false);

  const isEditing = editingId !== null;
  const carregarDados = useCallback(async () => {
    if (!session?.access_token || !usuario?.aplicativo_id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [fornecedoresResult, aplicativosResponse] = await Promise.all([
        supabase
          .from("fornecedores")
          .select("id, aplicativo_pai_id, nome, endereco, created_at, ativo")
          .eq("aplicativo_id", usuario.aplicativo_id)
          .eq("ativo", !mostrarEncerrados)
          .order("nome", { ascending: true }),
        fetch("/api/fornecedores/aplicativos-pai", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      const aplicativosJson = await aplicativosResponse.json() as {
        aplicativosPai?: AplicativoPaiOption[];
        error?: string;
      };
      if (fornecedoresResult.error || !aplicativosResponse.ok) {
        throw new Error(fornecedoresResult.error?.message ?? aplicativosJson.error ?? "Não foi possível carregar os fornecedores.");
      }
      setFornecedores((fornecedoresResult.data as Fornecedor[]) ?? []);
      setAplicativosPai(aplicativosJson.aplicativosPai ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível carregar os fornecedores.");
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token, usuario?.aplicativo_id, mostrarEncerrados]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function resetForm() {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setFormOpen(false);
  }

  function handleEdit(fornecedor: Fornecedor) {
    setEditingId(fornecedor.id);
    setFormOpen(true);
    setFormData({
      aplicativo_pai_id: fornecedor.aplicativo_pai_id,
      nome: fornecedor.nome,
      endereco: fornecedor.endereco ?? "",
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload = {
      aplicativo_pai_id: formData.aplicativo_pai_id,
      nome: formData.nome.trim(),
      endereco: formData.endereco.trim() || null,
    };

    if (!aplicativosPai.some((aplicativo) => aplicativo.id === payload.aplicativo_pai_id)) {
      setErrorMessage("Selecione um aplicativo pai válido para o fornecedor.");
      setIsSaving(false);
      return;
    }

    if (!payload.nome) {
      setErrorMessage("Nome do fornecedor é obrigatório.");
      setIsSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/fornecedores/salvar", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: editingId }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível salvar o fornecedor.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar fornecedor.");
      setIsSaving(false);
      return;
    }

    await carregarDados();
    resetForm();
    setSuccessMessage(
      isEditing
        ? "Fornecedor atualizado com sucesso."
        : "Fornecedor cadastrado com sucesso.",
    );
    setIsSaving(false);
  }

  async function handleDelete(fornecedor: Fornecedor) {
    const confirmar = window.confirm(`Encerrar o cadastro de ${fornecedor.nome}? O histórico será preservado. Ao encerrar a última relação ativa, os vínculos de vendedor serão desativados.`);

    if (!confirmar) return;

    setDeletingId(fornecedor.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/fornecedores/salvar", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: fornecedor.id }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível encerrar o fornecedor.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível encerrar o fornecedor.");
      setDeletingId(null);
      return;
    }

    if (editingId === fornecedor.id) {
      resetForm();
    }

    await carregarDados();
    setSuccessMessage("Cadastro do fornecedor encerrado. O histórico foi preservado.");
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
        <div className="flex flex-wrap items-center justify-between gap-4">
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm min-h-11 font-medium text-slate-700 hover:bg-slate-50"
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
              className="input mt-1 min-h-11 w-full"
              placeholder="Nome do fornecedor"
            />
          </label>

          <label className="text-sm text-slate-700">
            Aplicativo pai
            <select
              required
              value={formData.aplicativo_pai_id}
              onChange={(event) => setFormData((prev) => ({ ...prev, aplicativo_pai_id: event.target.value }))}
              disabled={isLoading || isSaving}
              className="input mt-1 min-h-11"
            >
              <option value="">Selecione o aplicativo pai</option>
              {aplicativosPai.map((aplicativo) => (
                <option key={aplicativo.id} value={aplicativo.id}>{aplicativo.nome}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">Aplicativo que receberá os novos pedidos na fila para direcionamento às filiais.</span>
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
              className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
                className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </form>
        )}

        {errorMessage && (
          <p role="alert" className="mt-4 text-sm text-red-600">{errorMessage}</p>
        )}
        {successMessage && (
          <p role="status" className="mt-4 text-sm text-emerald-700">{successMessage}</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{mostrarEncerrados ? "Fornecedores encerrados" : "Fornecedores cadastrados"}</h3>
          <button type="button" className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2" aria-pressed={mostrarEncerrados} onClick={() => { resetForm(); setMostrarEncerrados(atual => !atual); }}>{mostrarEncerrados ? "Mostrar ativos" : "Mostrar encerrados"}</button>
        </div>

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
                  <th className="p-3">Aplicativo pai</th>
                  <th className="p-3">Endereco</th>
                  <th className="p-3">Cadastro</th>
                  <th className="p-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map((fornecedor) => (
                  <tr key={fornecedor.id} className="border-b border-slate-100">
                    <td className="max-w-sm break-words p-3 font-medium text-slate-700">
                      {fornecedor.nome}
                    </td>
                    <td className="p-3 text-slate-700">
                      {aplicativosPai.find((aplicativo) => aplicativo.id === fornecedor.aplicativo_pai_id)?.nome ?? fornecedor.aplicativo_pai_id}
                    </td>
                    <td className="max-w-md break-words p-3 text-slate-700">
                      {fornecedor.endereco || "-"}
                    </td>
                    <td className="p-3 text-slate-700">
                      {new Date(fornecedor.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-3">
                      {fornecedor.ativo ? <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(fornecedor)}
                          className="min-h-11 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(fornecedor)}
                          disabled={deletingId === fornecedor.id}
                          className="min-h-11 rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === fornecedor.id ? "Encerrando..." : "Encerrar cadastro"}
                        </button>
                      </div> : <span className="text-slate-500">Encerrado · histórico preservado</span>}
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
