"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { botao, Feedback, painel, secundario, TelaAutomatizacao, useAutomatizacaoApi } from "@/components/automatizacao/compartilhado";

type Habilidade = { id: string; nome: string; arquivada: boolean; versoes: { numero: number; markdown: string }[] };
const vazio = { id: "", nome: "", markdown: "" };

export default function HabilidadesPage() {
  return <TelaAutomatizacao titulo="Habilidades" descricao="Cadastre e versione os prompts usados nas rotinas."><Habilidades /></TelaAutomatizacao>;
}

function Habilidades() {
  const api = useAutomatizacaoApi();
  const { usuario } = useAuth();
  const [lista, setLista] = useState<Habilidade[]>([]);
  const campoNome = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(vazio);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const carregar = useCallback(async () => {
    try { setLista(await api<Habilidade[]>("habilidades")); }
    catch (error) { setErro((error as Error).message); }
    finally { setCarregando(false); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function alterar(method: string, id?: string) {
    setSalvando(true);
    setErro("");
    setSucesso("");
    try {
      await api(id ? `habilidades?id=${id}` : "habilidades", method, method === "DELETE" ? undefined : form);
      setForm(vazio);
      setSucesso(method === "DELETE" ? "Habilidade arquivada." : "Habilidade salva.");
      await carregar();
    } catch (error) { setErro((error as Error).message); }
    finally { setSalvando(false); }
  }

  function salvar(evento: FormEvent) {
    evento.preventDefault();
    void alterar(form.id ? "PATCH" : "POST", form.id);
  }

  async function importar(arquivo: File) {
    try {
      if (!arquivo.name.toLowerCase().endsWith(".md") || arquivo.size > 128_000) throw new Error();
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(await arquivo.arrayBuffer());
      if (markdown.length > 32_000 || markdown.includes("\0")) throw new Error();
      setForm((anterior) => ({ ...anterior, markdown }));
      setErro("");
    } catch { setErro("Selecione um arquivo .md UTF-8 com até 32 mil caracteres."); }
  }

  return <div className="space-y-4">
    <Feedback {...{ carregando, erro, sucesso }} />
    {usuario?.podeEditarHabilidades && <form onSubmit={salvar} className={painel}>
      <h2 className="font-semibold">{form.id ? "Editar habilidade" : "Nova habilidade"}</h2>
      <fieldset disabled={salvando} className="min-w-0 space-y-4">
        <label className="block text-sm">Nome<input ref={campoNome} className="input mt-1 min-h-11 w-full" required maxLength={120} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
        <label className="block text-sm">Importar Markdown<input type="file" accept=".md,text/markdown" className="mt-1 block min-h-11 w-full" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ""; if (arquivo) void importar(arquivo); }} /></label>
        <label className="block text-sm">Prompt Markdown<textarea className="input mt-1 w-full" rows={8} required maxLength={32_000} value={form.markdown} onChange={(e) => setForm({ ...form, markdown: e.target.value })} /></label>
        <div className="flex flex-wrap gap-2">
          <button className={botao} type="submit">{salvando ? "Salvando…" : "Salvar habilidade"}</button>
          {form.id && <button className={secundario} type="button" onClick={() => setForm(vazio)}>Cancelar edição</button>}
        </div>
      </fieldset>
    </form>}
    {!carregando && !lista.length && <p>Nenhuma habilidade cadastrada.</p>}
    {lista.map((item) => <article key={item.id} className={painel}>
      <h2 className="break-words font-semibold">{item.nome}</h2>
      <p className="text-sm">Versão {item.versoes[0]?.numero} · {item.arquivada ? "Arquivada" : "Ativa"}</p>
      <div className="flex flex-wrap gap-2"><Link className={`${secundario} inline-flex items-center`} href={`/automatizacao/historico?habilidadeId=${encodeURIComponent(item.id)}`} aria-label={`Histórico da habilidade ${item.nome}`}>Histórico</Link></div>
      <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Ver prompt</summary>
        <pre className="whitespace-pre-wrap break-words text-sm">{item.versoes[0]?.markdown}</pre>
      </details>
      {usuario?.podeEditarHabilidades && !item.arquivada && <div className="flex flex-wrap gap-2">
        <button className={secundario} disabled={salvando} onClick={() => { setForm({ id: item.id, nome: item.nome, markdown: item.versoes[0]?.markdown ?? "" }); campoNome.current?.focus(); }}>Editar</button>
        <button className={secundario} disabled={salvando} onClick={() => { if (window.confirm(`Arquivar ${item.nome}?`)) void alterar("DELETE", item.id); }}>Arquivar</button>
      </div>}
    </article>)}
  </div>;
}
