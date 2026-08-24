"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { VariantesTab, parseVariantesImport, varianteInicial } from "@/components/gerador-csv-olist/gerador-csv-olist-client";
import { carregarGeradorCsvOlist, excluirVarianteOlist, importarVariantesOlist, salvarVarianteOlist, type EstampaOlist, type TamanhoOlist, type VarianteOlist } from "@/lib/gerador-csv-olist";

export function VariantesClient() {
  const { usuario } = useAuth();
  const canEdit = Boolean(usuario?.podeEditarVariantes);
  const [variantes, setVariantes] = useState<VarianteOlist[]>([]);
  const [estampas, setEstampas] = useState<EstampaOlist[]>([]);
  const [tamanhos, setTamanhos] = useState<TamanhoOlist[]>([]);
  const [form, setForm] = useState(varianteInicial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? variantes.filter((item) => [item.codigo, item.estampa?.codigo, item.tamanho?.titulo, item.tamanho?.sku].some((value) => value?.toLowerCase().includes(query))) : variantes;
  }, [search, variantes]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const data = await carregarGeradorCsvOlist(); setVariantes(data.variantes); setEstampas(data.estampas.filter((item) => item.ativo)); setTamanhos(data.tamanhos.filter((item) => item.ativo)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar variantes."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const codigo = form.codigo.trim().toUpperCase();
      if (!form.estampaId) throw new Error("Selecione a estampa da variante.");
      if (!form.tamanhoId) throw new Error("Selecione o tamanho da variante.");
      if (!codigo) throw new Error("Preencha o código da variante.");
      if (variantes.some((item) => item.estampaId === form.estampaId && item.codigo.toUpperCase() === codigo && item.id !== editingId)) throw new Error("Já existe uma variante com este código para esta estampa.");
      await salvarVarianteOlist({ id: editingId, estampaId: form.estampaId, tamanhoId: form.tamanhoId, codigo, descricao: form.descricao || null, palavrasChave: form.palavrasChave || null });
      setForm(varianteInicial); setEditingId(null); setMessage("Variante salva com sucesso."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar variante."); }
    finally { setSaving(false); }
  }

  async function importMany(text: string) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const items = parseVariantesImport(text);
      const resultado = await importarVariantesOlist(items);
      setMessage(`${resultado.criadas} variante(s) criada(s) e ${resultado.atualizadas} sobrescrita(s) com sucesso.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar variantes."); throw cause; }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!canEdit || !window.confirm("Excluir esta variante?")) return;
    setSaving(true); setMessage(null); setError(null);
    try { await excluirVarianteOlist(id); if (editingId === id) { setEditingId(null); setForm(varianteInicial); } setMessage("Variante excluída com sucesso."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao excluir variante."); }
    finally { setSaving(false); }
  }

  async function removeMany(ids: string[]) {
    if (!canEdit || !ids.length || !window.confirm(`Excluir ${ids.length} variante(s) selecionada(s)?`)) return false;
    setSaving(true); setMessage(null); setError(null);
    try { await Promise.all(ids.map((id) => excluirVarianteOlist(id))); if (editingId && ids.includes(editingId)) { setEditingId(null); setForm(varianteInicial); } setMessage(`${ids.length} variante(s) excluída(s) com sucesso.`); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao excluir variantes."); return false; }
    finally { setSaving(false); }
  }

  function fill(item: VarianteOlist, duplicate = false) { setEditingId(duplicate ? null : item.id); setForm({ estampaId: item.estampaId ?? "", tamanhoId: item.tamanhoId ?? "", codigo: duplicate ? `${item.codigo}-COPIA` : item.codigo, descricao: item.descricao ?? "", palavrasChave: item.palavrasChave ?? "" }); }

  return <div className="space-y-8"><PageHeader title="Variantes" description="Cadastre e gerencie as variantes usadas nos produtos Olist." />{message && <p className="text-sm text-emerald-700">{message}</p>}{error && <p className="text-sm text-red-600">{error}</p>}{loading ? <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando variantes...</section> : <VariantesTab variantes={filtered} estampas={estampas} tamanhos={tamanhos} form={form} setForm={setForm} editingId={editingId} setEditingId={setEditingId} busca={search} setBusca={setSearch} saving={saving} onSubmit={save} onImport={importMany} onEdit={(item) => fill(item)} onDuplicate={(item) => fill(item, true)} onDelete={remove} onDeleteMany={removeMany} canEdit={canEdit} />}</div>;
}
