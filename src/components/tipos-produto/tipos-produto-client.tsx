"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import {
  TiposProdutoTab,
  tipoInicial,
  type TipoProdutoCsvImportado,
} from "@/components/gerador-csv-olist/gerador-csv-olist-client";
import {
  carregarGeradorCsvOlist,
  excluirTipoProdutoOlist,
  salvarTipoProdutoOlist,
  type ProdutoFornecedorOlist,
  type TipoProdutoOlist,
} from "@/lib/gerador-csv-olist";

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function skuify(value: string) {
  return slugify(value).toUpperCase();
}

function formFromTipo(tipo: TipoProdutoOlist, duplicate = false) {
  return {
    titulo: duplicate ? `${tipo.titulo} Copia` : tipo.titulo,
    sku: duplicate ? `${tipo.sku}-COPIA` : tipo.sku,
    descricao: tipo.descricao ?? "",
    descricaoSeo: tipo.descricaoSeo ?? "",
    palavrasChave: tipo.palavrasChave ?? "",
    detalhesPromptIa: tipo.detalhesPromptIa ?? "",
    corteLaser: tipo.corteLaser,
    tecidoCorrido: tipo.tecidoCorrido,
    slug: duplicate ? `${tipo.slug ?? slugify(tipo.titulo)}-copia` : tipo.slug ?? "",
    categoria: tipo.categoria ?? "",
    produtosFornecidos: tipo.produtosFornecidos.slice(0, 1).map((item) => ({
      produtoFornecedorId: item.produtoFornecedorId,
      quantidadeUsada: String(item.quantidadeUsada),
    })),
  };
}

export function TiposProdutoClient() {
  const { usuario } = useAuth();
  const canEdit = Boolean(usuario?.podeEditarTiposProduto);
  const [tipos, setTipos] = useState<TipoProdutoOlist[]>([]);
  const [produtosFornecedor, setProdutosFornecedor] = useState<ProdutoFornecedorOlist[]>([]);
  const [form, setForm] = useState(tipoInicial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await carregarGeradorCsvOlist();
      setTipos(data.tiposProduto);
      setProdutosFornecedor(data.produtosFornecedor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar tipos de produto.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const titulo = form.titulo.trim();
      const produtoFornecedorId = form.produtosFornecidos[0]?.produtoFornecedorId;
      if (!titulo) throw new Error("Informe o título do tipo de produto.");
      if (!produtoFornecedorId) throw new Error("Selecione o produto fornecido do tipo de produto.");
      await salvarTipoProdutoOlist({
        id: editingId,
        titulo,
        sku: skuify(form.sku || titulo),
        descricao: form.descricao || null,
        descricaoSeo: form.descricaoSeo || null,
        palavrasChave: form.palavrasChave || null,
        detalhesPromptIa: form.detalhesPromptIa || null,
        corteLaser: form.corteLaser,
        tecidoCorrido: form.tecidoCorrido,
        slug: slugify(form.slug || titulo),
        categoria: form.categoria || null,
        produtosFornecidos: [{ produtoFornecedorId, quantidadeUsada: 1 }],
      });
      setForm(tipoInicial); setEditingId(null); setMessage("Tipo de produto salvo com sucesso.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao salvar tipo de produto.");
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!canEdit || !window.confirm("Excluir este tipo de produto?")) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      await excluirTipoProdutoOlist(id);
      if (editingId === id) { setEditingId(null); setForm(tipoInicial); }
      setMessage("Tipo de produto excluído com sucesso.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao excluir tipo de produto.");
    } finally { setSaving(false); }
  }

  async function removeMany(ids: string[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      await Promise.all(ids.map((id) => excluirTipoProdutoOlist(id)));
      if (editingId && ids.includes(editingId)) { setEditingId(null); setForm(tipoInicial); }
      setMessage(`${ids.length} tipo(s) de produto excluído(s) com sucesso.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao excluir tipos de produto.");
      throw cause;
    } finally { setSaving(false); }
  }

  async function importMany(items: TipoProdutoCsvImportado[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const tiposPorSku = new Map(tipos.map((tipo) => [tipo.sku.trim().toUpperCase(), tipo]));
      const totalAtualizados = items.filter((item) => tiposPorSku.has(item.sku.trim().toUpperCase())).length;
      await Promise.all(items.map((item) => salvarTipoProdutoOlist({
        id: tiposPorSku.get(item.sku.trim().toUpperCase())?.id ?? null,
        titulo: item.titulo,
        sku: item.sku,
        corteLaser: item.corteLaser,
        tecidoCorrido: item.tecidoCorrido,
        categoria: item.categoria || null,
        slug: slugify(item.slug || item.titulo),
        descricao: item.descricao || null,
        descricaoSeo: item.descricaoSeo || null,
        palavrasChave: item.palavrasChave || null,
        detalhesPromptIa: item.detalhesPromptIa || null,
        produtosFornecidos: [{ produtoFornecedorId: item.produtoFornecedorId, quantidadeUsada: 1 }],
      })));
      setMessage(`${items.length - totalAtualizados} tipo(s) criado(s) e ${totalAtualizados} sobrescrito(s) com sucesso.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao importar tipos de produto.");
      throw cause;
    } finally { setSaving(false); }
  }

  return <div className="space-y-8">
    <PageHeader title="Tipos de Produto" description="Cadastre e consulte os tipos de produto usados na geração dos produtos Olist." />
    {message && <p className="text-sm text-emerald-700">{message}</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {loading ? <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando tipos de produto...</section> :
      <TiposProdutoTab tipos={tipos} produtosFornecedor={produtosFornecedor} form={form} setForm={setForm} editingId={editingId} setEditingId={setEditingId} saving={saving} onSubmit={save} onEdit={(tipo) => { setEditingId(tipo.id); setForm(formFromTipo(tipo)); }} onDuplicate={(tipo) => { setEditingId(null); setForm(formFromTipo(tipo, true)); }} onDelete={remove} onDeleteMany={removeMany} onImport={importMany} canEdit={canEdit} />}
  </div>;
}
