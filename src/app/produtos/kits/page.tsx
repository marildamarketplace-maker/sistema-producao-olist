"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ImportarKitsEstoque } from "@/components/importar-kits-estoque";
import { AccessGuard } from "@/components/access-guard";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

type Componente = { kitSku: string; sku: string; quantidade: number };
export default function KitsPage() {
  const { usuario } = useAuth();
  const editar = Boolean(usuario?.podeEditarEstoque);
  const [lista, setLista] = useState<Componente[]>([]);
  const [sku, setSku] = useState("");
  const [componentes, setComponentes] = useState([{ sku: "", quantidade: "1" }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  async function requisitar(method = "GET", body?: unknown) {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/produtos/kits", { method, headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Erro ao consultar kits.");
    return json;
  }
  useEffect(() => { let ativo = true; requisitar().then((data) => { if (ativo) setLista(data.componentes); }).catch((error) => { if (ativo) setErro(error.message); }).finally(() => { if (ativo) setLoading(false); }); return () => { ativo = false; }; }, []);
  async function salvar(event: FormEvent, remover = false) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setErro(""); setMensagem("");
    try {
      await requisitar("PUT", { sku, componentes: remover ? [] : componentes.map((item) => ({ sku: item.sku, quantidade: Number(item.quantidade) })) });
      setMensagem(remover ? "Associação removida. Próximas baixas usarão o SKU original." : "Composição salva. Próximas baixas usarão os componentes.");
      const data = await requisitar(); setLista(data.componentes);
    } catch (error) { setErro(error instanceof Error ? error.message : "Erro ao salvar."); }
    finally { setSaving(false); }
  }
  const botao = "min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50";
  return <AccessGuard permissions={["podeVisualizarEstoque", "podeEditarEstoque"]}>
    <PageHeader title="Associação de kits" description="Informe o SKU vendido como kit e os produtos individuais que terão saída de estoque. A quantidade é por unidade do kit. Alterações valem para próximas baixas e gerações automáticas de produção." />
    <div className="space-y-4">
      {erro && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>}
      {mensagem && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{mensagem}</p>}
      {editar && <form onSubmit={salvar} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <fieldset disabled={saving || loading} className="min-w-0 space-y-4">
          <label className="block text-sm font-medium">SKU do kit<input required maxLength={255} className="input mt-1 min-h-11 w-full" value={sku} onChange={(event) => setSku(event.target.value)} /></label>
          {componentes.map((item, index) => <div key={index} className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <label className="min-w-0 text-sm">SKU do componente {index + 1}<input required maxLength={255} className="input mt-1 min-h-11 w-full" value={item.sku} onChange={(event) => setComponentes((atual) => atual.map((row, i) => i === index ? { ...row, sku: event.target.value } : row))} /></label>
            <label className="text-sm">Qtd. por kit<input required type="number" min="1" max="2147483647" step="1" className="input mt-1 min-h-11 w-full" value={item.quantidade} onChange={(event) => setComponentes((atual) => atual.map((row, i) => i === index ? { ...row, quantidade: event.target.value } : row))} /></label>
            <button type="button" className={botao} disabled={componentes.length === 1} onClick={() => setComponentes((atual) => atual.filter((_, i) => i !== index))}>Remover componente {index + 1}</button>
          </div>)}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={botao} disabled={componentes.length >= 100} onClick={() => setComponentes((atual) => [...atual, { sku: "", quantidade: "1" }])}>Adicionar componente</button>
            <button type="submit" className={`${botao} bg-slate-900 text-white`}>{saving ? "Salvando…" : "Salvar composição"}</button>
            {lista.some((item) => item.kitSku === sku.trim()) && <button type="button" className={botao} onClick={(event) => void salvar(event, true)}>Desfazer associação deste kit</button>}
          </div>
        </fieldset>
      </form>}
      {editar && <ImportarKitsEstoque ocupada={saving || loading} existentes={[...new Set(lista.map((item) => item.kitSku))]} importar={async (kits) => {
        setSaving(true); setErro(""); setMensagem("");
        try {
          await requisitar("POST", { kits });
          const substituidos = new Set(kits.map((kit) => kit.sku));
          const kitEmEdicao = kits.find((kit) => kit.sku === sku.trim());
          if (kitEmEdicao) setComponentes(kitEmEdicao.componentes.map((item) => ({ sku: item.sku, quantidade: String(item.quantidade) })));
          setLista((atual) => [...atual.filter((item) => !substituidos.has(item.kitSku)),
            ...kits.flatMap((kit) => kit.componentes.map((item) => ({ ...item, kitSku: kit.sku })))].sort((a, b) => a.kitSku.localeCompare(b.kitSku) || a.sku.localeCompare(b.sku)));
        } finally { setSaving(false); }
      }} />}
      <section aria-label="Kits cadastrados" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="font-semibold">Kits cadastrados</h3>
        {loading ? <p role="status">Carregando…</p> : lista.length === 0 ? <p className="text-sm text-slate-500">Nenhum kit associado.</p> : [...new Set(lista.map((item) => item.kitSku))].map((kitSku) => <article key={kitSku} className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
          <h4 className="break-all text-sm font-medium">{kitSku}</h4>
          <ul className="space-y-2 text-sm text-slate-600">{lista.filter((item) => item.kitSku === kitSku).map((item) => <li className="break-all" key={item.sku}>{item.quantidade} × {item.sku}</li>)}</ul>
          {editar && <button disabled={saving} type="button" className={botao} onClick={() => { setSku(kitSku); setComponentes(lista.filter((item) => item.kitSku === kitSku).map((item) => ({ sku: item.sku, quantidade: String(item.quantidade) }))); setMensagem(""); }}>Editar composição</button>}
        </article>)}
      </section>
    </div>
  </AccessGuard>;
}
