"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { EstampasTab, estampaInicial, parseEstampasImport } from "@/components/gerador-csv-olist/gerador-csv-olist-client";
import {
  carregarGeradorCsvOlist,
  excluirEstampaOlist,
  salvarEstampaOlist,
  uploadImagemEstampaOlist,
  verificarImagensEstampasOlist,
  type EstampaOlist,
} from "@/lib/gerador-csv-olist";

export function EstampasClient() {
  const { usuario } = useAuth();
  const canEdit = Boolean(usuario?.podeEditarEstampas);
  const [estampas, setEstampas] = useState<EstampaOlist[]>([]);
  const [form, setForm] = useState(estampaInicial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<[File | null, File | null]>([null, null]);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? estampas.filter((item) => [item.codigo, item.descricao, item.palavrasChave, item.extra].some((value) => value?.toLowerCase().includes(query))) : estampas;
  }, [estampas, search]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setEstampas((await carregarGeradorCsvOlist()).estampas); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar estampas."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setForm(estampaInicial); setEditingId(null); setImageFiles([null, null]); setImageInputKey((key) => key + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const codigo = form.codigo.trim().toUpperCase();
      if (!codigo) throw new Error("Preencha o código da estampa.");
      if (estampas.some((item) => item.codigo.toUpperCase() === codigo && item.id !== editingId)) throw new Error("Já existe uma estampa cadastrada com este código.");
      const response = await salvarEstampaOlist({ id: editingId, codigo, descricao: form.descricao || null, palavrasChave: form.palavrasChave || null, extra: form.extra || null });
      for (const [index, file] of imageFiles.entries()) {
        if (file) await uploadImagemEstampaOlist({ id: response.estampa.id, codigo: response.estampa.codigo, file, index: index as 0 | 1 });
      }
      const imageCount = imageFiles.filter(Boolean).length;
      resetForm(); setMessage(imageCount ? `Estampa e ${imageCount} imagem(ns) salvas com sucesso.` : "Estampa salva com sucesso.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar estampa."); }
    finally { setSaving(false); }
  }

  async function importMany(text: string) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const imported = parseEstampasImport(text);
      const codes = new Set<string>();
      const duplicates = imported.map((item) => item.codigo).filter((code) => codes.has(code) || !codes.add(code));
      if (duplicates.length) throw new Error(`Códigos duplicados no arquivo: ${Array.from(new Set(duplicates)).join(", ")}.`);
      const currentByCode = new Map(estampas.map((item) => [item.codigo.toUpperCase(), item]));
      const updated = imported.filter((item) => currentByCode.has(item.codigo)).length;
      await Promise.all(imported.map((item) => salvarEstampaOlist({ id: currentByCode.get(item.codigo)?.id ?? null, ...item })));
      setMessage(`${imported.length - updated} estampa(s) criada(s) e ${updated} substituída(s) com sucesso.`); await load();
    } catch (cause) { const detail = cause instanceof Error ? cause.message : "Erro ao importar estampas."; setError(detail); throw cause; }
    finally { setSaving(false); }
  }

  async function verifyImages(ids: string[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const result = await verificarImagensEstampasOlist(ids);
      setMessage(`Verificação concluída: ${result.totalVerificadas} estampa(s), ${result.imagem0Encontradas} imagem(ns) 0 e ${result.imagem1Encontradas} imagem(ns) 1 encontradas. ${result.estampasAtualizadas} estampa(s) atualizada(s).`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao verificar imagens das estampas."); }
    finally { setSaving(false); }
  }

  function fillForm(item: EstampaOlist, duplicate = false) {
    setEditingId(duplicate ? null : item.id);
    setForm({ codigo: duplicate ? `${item.codigo}-COPIA` : item.codigo, descricao: item.descricao ?? "", palavrasChave: item.palavrasChave ?? "", extra: item.extra ?? "" });
    setImageFiles([null, null]); setImageInputKey((key) => key + 1);
  }

  async function remove(id: string) {
    if (!canEdit || !window.confirm("Excluir esta estampa?")) return;
    setSaving(true); setMessage(null); setError(null);
    try { await excluirEstampaOlist(id); if (editingId === id) resetForm(); setMessage("Estampa excluída com sucesso."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao excluir estampa."); }
    finally { setSaving(false); }
  }

  async function removeMany(ids: string[]) {
    if (!canEdit) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      await Promise.all(ids.map((id) => excluirEstampaOlist(id)));
      if (editingId && ids.includes(editingId)) resetForm();
      setMessage(`${ids.length} estampa(s) excluída(s) com sucesso.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao excluir estampas.");
      throw cause;
    } finally { setSaving(false); }
  }

  return <div className="space-y-8">
    <PageHeader title="Estampas" description="Cadastre, importe e gerencie as estampas usadas nos produtos Olist." />
    {message && <p className="text-sm text-emerald-700">{message}</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {loading ? <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando estampas...</section> :
      <EstampasTab estampas={filtered} form={form} setForm={setForm} imagemFiles={imageFiles} setImagemFiles={setImageFiles} imagemInputKey={imageInputKey} resetImagemInput={() => setImageInputKey((key) => key + 1)} editingId={editingId} setEditingId={setEditingId} busca={search} setBusca={setSearch} saving={saving} onSubmit={save} onImport={importMany} onVerifyImages={verifyImages} onEdit={(item) => fillForm(item)} onDuplicate={(item) => fillForm(item, true)} onDelete={remove} onDeleteMany={removeMany} canEdit={canEdit} />}
  </div>;
}
