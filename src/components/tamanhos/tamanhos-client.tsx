"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { TamanhosTab, tamanhoInicial, type TamanhoCsvImportado } from "@/components/gerador-csv-olist/gerador-csv-olist-client";
import {
  carregarGeradorCsvOlist,
  excluirTamanhoOlist,
  salvarTamanhoOlist,
  type TamanhoOlist,
} from "@/lib/gerador-csv-olist";

function decimalValue(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  if (!normalized || Number.isNaN(number) || number < 0) throw new Error("Informe uma quantidade usada válida.");
  return number;
}

function inputNumber(value: number | null) {
  return value === null ? "" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(value);
}

export function TamanhosClient() {
  const { usuario } = useAuth();
  const canEdit = Boolean(usuario?.podeEditarTamanhos);
  const [tamanhos, setTamanhos] = useState<TamanhoOlist[]>([]);
  const [form, setForm] = useState(tamanhoInicial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? tamanhos.filter((item) => [item.titulo, item.sku, item.slug].some((value) => value?.toLowerCase().includes(query))) : tamanhos;
  }, [search, tamanhos]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setTamanhos((await carregarGeradorCsvOlist()).tamanhos); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar tamanhos."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const titulo = form.titulo.trim();
      const sku = form.sku.trim().toUpperCase();
      if (!titulo || !sku) throw new Error("Preencha os campos obrigatórios: Título e SKU.");
      if (tamanhos.some((item) => item.sku.toUpperCase() === sku && item.id !== editingId)) throw new Error("Já existe um tamanho cadastrado com este SKU.");
      await salvarTamanhoOlist({ id: editingId, titulo, sku, slug: form.slug || null, quantidadeProdutoFornecedor: decimalValue(form.quantidadeProdutoFornecedor) });
      setForm(tamanhoInicial); setEditingId(null); setMessage("Tamanho salvo com sucesso.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar tamanho."); }
    finally { setSaving(false); }
  }

  function fillForm(item: TamanhoOlist, duplicate = false) {
    setEditingId(duplicate ? null : item.id);
    setForm({
      titulo: duplicate ? `${item.titulo} Copia` : item.titulo,
      sku: duplicate ? `${item.sku}-COPIA` : item.sku,
      slug: duplicate ? `${item.slug ?? item.sku.toLowerCase()}-copia` : item.slug ?? "",
      quantidadeProdutoFornecedor: inputNumber(item.quantidadeProdutoFornecedor),
    });
  }

  async function remove(id: string) {
    if (!canEdit || !window.confirm("Excluir este tamanho?")) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      await excluirTamanhoOlist(id);
      if (editingId === id) { setEditingId(null); setForm(tamanhoInicial); }
      setMessage("Tamanho excluído com sucesso."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao excluir tamanho."); }
    finally { setSaving(false); }
  }

  async function importMany(items: TamanhoCsvImportado[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const tamanhosPorSku = new Map(tamanhos.map((item) => [item.sku.trim().toUpperCase(), item]));
      const totalAtualizados = items.filter((item) => tamanhosPorSku.has(item.sku.trim().toUpperCase())).length;
      await Promise.all(items.map((item) => salvarTamanhoOlist({
        id: tamanhosPorSku.get(item.sku.trim().toUpperCase())?.id ?? null,
        titulo: item.titulo,
        sku: item.sku,
        slug: item.slug || null,
        quantidadeProdutoFornecedor: item.quantidadeProdutoFornecedor,
      })));
      setMessage(`${items.length - totalAtualizados} tamanho(s) criado(s) e ${totalAtualizados} sobrescrito(s) com sucesso.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao importar tamanhos.");
      throw cause;
    } finally { setSaving(false); }
  }

  async function removeMany(ids: string[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      await Promise.all(ids.map((id) => excluirTamanhoOlist(id)));
      if (editingId && ids.includes(editingId)) { setEditingId(null); setForm(tamanhoInicial); }
      setMessage(`${ids.length} tamanho(s) excluído(s) com sucesso.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao excluir tamanhos.");
      throw cause;
    } finally { setSaving(false); }
  }

  return <div className="space-y-8">
    <PageHeader title="Tamanho" description="Cadastre e consulte os tamanhos usados na geração dos produtos Olist." />
    {message && <p className="text-sm text-emerald-700">{message}</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {loading ? <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando tamanhos...</section> :
      <TamanhosTab tamanhos={filtered} form={form} setForm={setForm} editingId={editingId} setEditingId={setEditingId} busca={search} setBusca={setSearch} saving={saving} onSubmit={save} onEdit={(item) => fillForm(item)} onDuplicate={(item) => fillForm(item, true)} onDelete={remove} onDeleteMany={removeMany} onImport={importMany} canEdit={canEdit} />}
  </div>;
}
