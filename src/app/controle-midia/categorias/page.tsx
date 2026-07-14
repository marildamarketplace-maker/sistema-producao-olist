"use client";

import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download, ImagePlus, Loader2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type Categoria = {
  id: string;
  olistId: string;
  nome: string;
  caminho: string;
  parentOlistId: string | null;
  nivel: number;
};
type Midia = { id: string; tipo: TipoMidia; titulo: string | null; arquivoUrl: string; contentType: string; createdAt: string; categoria: { id: string; nome: string; caminho: string } | null };
type TipoMidia = "HOME_PC" | "HOME_MOBILE" | "CATEGORIA" | "STORY" | "FEED";

const TIPOS: { value: TipoMidia; label: string; medida: string }[] = [
  { value: "HOME_PC", label: "Home PC", medida: "1580 × 700 px" },
  { value: "HOME_MOBILE", label: "Home Mobile", medida: "820 × 1000 px" },
  { value: "CATEGORIA", label: "Tela da categoria", medida: "1580 × 220 px" },
  { value: "STORY", label: "Stories", medida: "Formato vertical" },
  { value: "FEED", label: "Postagem no feed", medida: "Formato do feed" },
];

const PROPORCOES: Record<TipoMidia, { largura: number; altura: number; descricao: string }> = {
  HOME_PC: { largura: 79, altura: 35, descricao: "79:35 (1580×700)" },
  HOME_MOBILE: { largura: 41, altura: 50, descricao: "41:50 (820×1000)" },
  CATEGORIA: { largura: 79, altura: 11, descricao: "79:11 (1580×220)" },
  STORY: { largura: 9, altura: 16, descricao: "9:16" },
  FEED: { largura: 1, altura: 1, descricao: "1:1" },
};

export default function ControleMidiaCategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [midias, setMidias] = useState<Midia[]>([]);
  const [tipo, setTipo] = useState<TipoMidia>("HOME_PC");
  const [categoriaId, setCategoriaId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [importando, setImportando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [dragAtivo, setDragAtivo] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [promptCopiado, setPromptCopiado] = useState(false);
  const preview = useMemo(() => arquivo ? URL.createObjectURL(arquivo) : null, [arquivo]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [categoriasResponse, midiasResponse] = await Promise.all([
        fetch("/api/controle-midia/categorias"), fetch("/api/controle-midia/midias"),
      ]);
      if (!categoriasResponse.ok || !midiasResponse.ok) throw new Error("Não foi possível carregar os dados.");
      setCategorias((await categoriasResponse.json()).categorias);
      setMidias((await midiasResponse.json()).midias);
    } catch (error) { setMensagem({ tipo: "erro", texto: error instanceof Error ? error.message : "Erro ao carregar." }); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function selecionarArquivo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setMensagem({ tipo: "erro", texto: "Selecione uma imagem ou vídeo." }); return;
    }
    setArquivo(file); setMensagem(null);
  }

  async function importar() {
    setImportando(true); setMensagem(null);
    try {
      const response = await fetch("/api/controle-midia/categorias", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha na importação.");
      setMensagem({ tipo: "ok", texto: `${data.categorias} categorias e ${data.subcategorias} subcategorias importadas da Olist.` }); await carregar();
    } catch (error) { setMensagem({ tipo: "erro", texto: error instanceof Error ? error.message : "Erro ao importar." }); }
    finally { setImportando(false); }
  }

  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (!arquivo) { setMensagem({ tipo: "erro", texto: "Selecione um arquivo para enviar." }); return; }
    setEnviando(true); setMensagem(null);
    try {
      const form = new FormData(); form.set("arquivo", arquivo); form.set("tipo", tipo); form.set("titulo", titulo);
      if (categoriaId) form.set("categoriaId", categoriaId);
      const response = await fetch("/api/controle-midia/midias", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha no upload.");
      setArquivo(null); setTitulo(""); setMensagem({ tipo: "ok", texto: "Mídia enviada e link disponibilizado." }); await carregar();
    } catch (error) { setMensagem({ tipo: "erro", texto: error instanceof Error ? error.message : "Erro no upload." }); }
    finally { setEnviando(false); }
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir esta mídia do cadastro e do storage?")) return;
    const response = await fetch(`/api/controle-midia/midias?id=${id}`, { method: "DELETE" });
    if (response.ok) { setMidias((atuais) => atuais.filter((item) => item.id !== id)); setMensagem({ tipo: "ok", texto: "Mídia excluída." }); }
    else setMensagem({ tipo: "erro", texto: (await response.json()).error ?? "Erro ao excluir." });
  }

  async function copiar(url: string, id: string) { await navigator.clipboard.writeText(url); setCopiado(id); setTimeout(() => setCopiado(null), 1800); }
  async function copiarPrompt() {
    const formato = TIPOS.find((item) => item.value === tipo)!;
    const categoria = categorias.find((item) => item.id === categoriaId);
    if (tipo === "CATEGORIA" && !categoria) {
      setMensagem({ tipo: "erro", texto: "Selecione uma categoria ou subcategoria antes de copiar o prompt deste formato." });
      return;
    }
    const contextoTitulo = titulo.trim() || "defina uma chamada curta, clara e comercial coerente com a arte";
    const contextoCategoria = categoria?.caminho ?? "conteúdo geral da loja";
    const proporcao = PROPORCOES[tipo].descricao;
    const dimensoesExatas = tipo === "STORY" || tipo === "FEED" ? "" : `, mantendo as dimensões exatas de ${formato.medida}`;
    const orientacao = tipo === "STORY" ? "vertical" : tipo === "FEED" ? "quadrada" : "horizontal";
    const prompt = `Crie uma arte publicitária profissional para e-commerce no formato ${formato.label}.

Formato: ${formato.label}
Proporção obrigatória: ${proporcao}${dimensoesExatas}
Orientação: ${orientacao}
Título/campanha: ${contextoTitulo}
Categoria: ${contextoCategoria}

A arte deve ter aparência moderna, comercial e premium, com boa hierarquia visual, contraste adequado e composição limpa. Use elementos visuais coerentes com a categoria e com o título informado. Mantenha textos, logotipos, produtos e elementos importantes dentro de uma área segura, sem encostar nas bordas nem cortar informações. Garanta boa legibilidade em telas e não altere a proporção ou as dimensões solicitadas. Não invente preços, descontos, marcas, produtos ou informações não fornecidas. Entregue somente a arte final, sem mockup, moldura, margens externas ou explicações.`;
    await navigator.clipboard.writeText(prompt);
    setMensagem(null);
    setPromptCopiado(true);
    setTimeout(() => setPromptCopiado(false), 2000);
  }
  const categoriasFiltradas = categorias.filter((item) => item.caminho.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")));
  const totalCategorias = categorias.filter((item) => !item.parentOlistId).length;
  const totalSubcategorias = categorias.length - totalCategorias;
  const formatosPorCategoria = useMemo(() => {
    const mapa = new Map<string, Set<TipoMidia>>();
    for (const midia of midias) {
      if (!midia.categoria) continue;
      const formatos = mapa.get(midia.categoria.id) ?? new Set<TipoMidia>();
      formatos.add(midia.tipo);
      mapa.set(midia.categoria.id, formatos);
    }
    return mapa;
  }, [midias]);

  return <div className="space-y-8">
    <PageHeader title="Categorias e mídias" description="Importe a árvore da Olist e gerencie banners e conteúdos publicados no storage." />
    {mensagem && <div className={`rounded-lg border px-4 py-3 text-sm ${mensagem.tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{mensagem.texto}</div>}

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-slate-900">Categorias da Olist</h2><p className="mt-1 text-sm text-slate-500">{totalCategorias} categorias e {totalSubcategorias} subcategorias</p></div>
        <button onClick={importar} disabled={importando} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Importar categorias Olist
        </button>
      </div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar categoria..." className="mt-5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200">
        {carregando ? <p className="p-5 text-center text-sm text-slate-500">Carregando...</p> : categoriasFiltradas.length ? <table className="w-full min-w-[760px] border-collapse"><thead className="sticky top-0 z-10 bg-slate-100"><tr><th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-600">Categoria / subcategoria</th>{TIPOS.map((formato) => <th key={formato.value} className="w-24 px-2 py-2.5 text-center text-xs font-semibold text-slate-600">{formato.label}</th>)}</tr></thead><tbody>{categoriasFiltradas.map((item) => <tr key={item.id} className={`border-t border-slate-100 ${item.parentOlistId ? "bg-slate-50/60" : "bg-white"}`}><td className="py-2.5 pr-4" style={{ paddingLeft: `${16 + Math.min(item.nivel, 6) * 24}px` }}><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${item.parentOlistId ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`}>{item.parentOlistId ? "Subcategoria" : "Categoria"}</span><span className={`text-sm ${item.parentOlistId ? "text-slate-700" : "font-medium text-slate-900"}`}>{item.nome}</span></div><p className="mt-0.5 text-xs text-slate-400">ID Olist: {item.olistId}</p></td>{TIPOS.map((formato) => { const possui = formatosPorCategoria.get(item.id)?.has(formato.value) ?? false; return <td key={formato.value} className="px-2 py-2.5 text-center">{possui ? <span title={`${formato.label} cadastrado`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-4 w-4" /></span> : <span title={`${formato.label} não cadastrado`} className="inline-block h-2 w-2 rounded-full bg-slate-200" />}</td>; })}</tr>)}</tbody></table> : <p className="p-5 text-center text-sm text-slate-500">Nenhuma categoria encontrada.</p>}
      </div>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">Cadastrar mídia</h2>
      <form onSubmit={salvar} className="mt-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Formato<select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoMidia); if (e.target.value !== "CATEGORIA") setCategoriaId(""); }} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">{TIPOS.map((item) => <option key={item.value} value={item.value}>{item.label} — {PROPORCOES[item.value].descricao}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Título (opcional)<input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
          <label className="text-sm font-medium text-slate-700">Categoria ou subcategoria {tipo !== "CATEGORIA" && <span className="font-normal text-slate-400">(opcional)</span>}<select required={tipo === "CATEGORIA"} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"><option value="">{tipo === "CATEGORIA" ? "Selecione..." : "Mídia geral (sem categoria)"}</option>{categorias.map((item) => <option key={item.id} value={item.id}>{`${item.parentOlistId ? "↳ " : ""}${"— ".repeat(Math.max(0, item.nivel - 1))}${item.nome}`}</option>)}</select></label>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="flex items-center gap-2 text-sm font-medium text-violet-900"><Sparkles className="h-4 w-4" /> Prompt para criação do banner</p><p className="mt-1 text-xs text-violet-700">Usa o formato, título e categoria selecionados acima.</p></div>
          <button type="button" onClick={copiarPrompt} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-800 transition hover:bg-violet-100">{promptCopiado ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />} {promptCopiado ? "Prompt copiado" : "Copiar prompt"}</button>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDragAtivo(true); }} onDragLeave={() => setDragAtivo(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragAtivo(false); selecionarArquivo(e.dataTransfer.files[0]); }} className={`relative rounded-xl border-2 border-dashed p-6 text-center transition ${dragAtivo ? "border-slate-700 bg-slate-50" : "border-slate-300"}`}>
          <input type="file" accept="image/*,video/*" onChange={(e: ChangeEvent<HTMLInputElement>) => selecionarArquivo(e.target.files?.[0])} className="absolute inset-0 cursor-pointer opacity-0" />
          {preview ? <div className="flex items-center justify-center gap-4">{arquivo?.type.startsWith("video/") ? <video src={preview} className="h-24 w-32 rounded-lg object-cover" /> : <img src={preview} alt="Preview" className="h-24 w-32 rounded-lg object-cover" />}<div className="min-w-0 text-left"><p className="truncate text-sm font-medium text-slate-800">{arquivo?.name}</p><p className="text-xs text-slate-500">{arquivo && (arquivo.size / 1024 / 1024).toFixed(2)} MB</p><p className="mt-1 text-xs text-slate-500">Clique ou arraste para trocar</p></div></div> : <><UploadCloud className="mx-auto h-9 w-9 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">Arraste o arquivo ou clique para selecionar</p><p className="mt-1 text-xs text-slate-500">Imagem ou vídeo, até 20 MB · Proporção recomendada {PROPORCOES[tipo].descricao}</p></>}
        </div>
        <button disabled={enviando} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Enviar para o storage</button>
      </form>
    </section>

    <section><h2 className="font-semibold text-slate-900">Mídias cadastradas</h2><div className="mt-4 grid gap-4 lg:grid-cols-2">{midias.map((item) => <article key={item.id} className="flex min-w-0 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{item.contentType.startsWith("video/") ? <video src={item.arquivoUrl} className="h-24 w-28 shrink-0 rounded-lg bg-slate-100 object-cover" controls /> : <img src={item.arquivoUrl} alt={item.titulo ?? "Mídia"} className="h-24 w-28 shrink-0 rounded-lg bg-slate-100 object-cover" />}<div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase text-slate-500">{TIPOS.find((tipo) => tipo.value === item.tipo)?.label}</p><p className="mt-1 truncate text-sm font-medium text-slate-900">{item.titulo ?? item.categoria?.caminho ?? "Sem título"}</p><a href={item.arquivoUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs text-blue-600 hover:underline">{item.arquivoUrl}</a><div className="mt-3 flex gap-2"><button onClick={() => copiar(item.arquivoUrl, item.id)} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">{copiado === item.id ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />} {copiado === item.id ? "Copiado" : "Copiar link"}</button><button onClick={() => excluir(item.id)} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700"><Trash2 className="h-3.5 w-3.5" /> Excluir</button></div></div></article>)}{!carregando && !midias.length && <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Nenhuma mídia cadastrada.</div>}</div></section>
  </div>;
}
