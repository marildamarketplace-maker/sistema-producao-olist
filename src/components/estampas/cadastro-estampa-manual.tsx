"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Existente = { id: string; codigo: string; variante: string | null; previewUrl: string | null };
export function CadastroEstampaManual({ token, onCadastrada }: { token: string; onCadastrada: (codigo: string, variante: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [variante, setVariante] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [existente, setExistente] = useState<Existente | null>(null);
  const bloqueado = useRef(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!arquivo) { setPreview(null); return; }
    const url = URL.createObjectURL(arquivo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!arquivo || bloqueado.current) return;
    bloqueado.current = true; setEnviando(true); setErro(null); setMensagem(null); setExistente(null);
    try {
      const form = new FormData(); form.set("codigo", codigo.trim()); form.set("variante", variante.trim()); form.set("imagem", arquivo);
      const resposta = await fetch("/api/estampas/cadastro-manual", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const dados = await resposta.json();
      if (!resposta.ok) { if (dados.existente) setExistente(dados.existente); throw new Error(dados.error ?? "Falha no cadastro."); }
      setMensagem(dados.mensagem); onCadastrada(codigo.trim(), variante.trim());
      setCodigo(""); setVariante(""); setArquivo(null);
      if (inputArquivo.current) inputArquivo.current.value = "";
    } catch (error) { setErro(error instanceof Error ? error.message : "Falha no cadastro."); }
    finally { bloqueado.current = false; setEnviando(false); }
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-5">
    <button type="button" aria-expanded={aberto} aria-controls="cadastro-estampa" onClick={() => setAberto(!aberto)} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{aberto ? "Fechar cadastro" : "Cadastrar imagem"}</button>
    {aberto && <form id="cadastro-estampa" onSubmit={enviar} className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">A imagem entra no catálogo e na fila de IA. Filtros de nome/variante e pausa global continuam valendo. Somente a versão otimizada (até 1024 px) será armazenada.</p>
      <fieldset disabled={enviando} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium text-slate-700">Código obrigatório<input required maxLength={100} className="input mt-1 min-h-11" value={codigo} onChange={e => setCodigo(e.target.value)} /></label>
        <label className="min-w-0 text-sm font-medium text-slate-700">Variante obrigatória<input required maxLength={100} className="input mt-1 min-h-11" value={variante} onChange={e => setVariante(e.target.value)} /></label>
        <label className="min-w-0 text-sm font-medium text-slate-700 sm:col-span-2">Imagem obrigatória<input ref={inputArquivo} required type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block min-h-11 w-full min-w-0 text-sm" onChange={e => { const file = e.target.files?.[0] ?? null; setErro(null); setExistente(null); if (file && file.size > 4 * 1024 * 1024) { setErro("Envie uma imagem de até 4 MB."); setArquivo(null); e.target.value = ""; } else setArquivo(file); }} /><span className="mt-1 block text-xs text-slate-500">JPEG, PNG ou WebP estático. Até 4 MB e 40 megapixels.</span></label>
      </fieldset>
      {preview && <img src={preview} alt="Prévia da imagem selecionada" className="max-h-64 max-w-full rounded-md object-contain" />}
      {erro && <p role="alert" className="break-words text-sm text-red-700">{erro}</p>}
      {existente && <div className="space-y-2 rounded-md border border-slate-200 p-3 text-sm"><p className="break-words">Cadastro existente: {existente.codigo} · {existente.variante} (ID {existente.id})</p>{existente.previewUrl && <img src={existente.previewUrl} alt="Imagem já cadastrada" loading="lazy" className="max-h-40 max-w-full object-contain" />}<button type="button" onClick={() => onCadastrada(existente.codigo, existente.variante ?? "")} className="min-h-11 rounded-md border border-slate-300 px-4 py-2">Mostrar jobs deste cadastro</button></div>}
      {mensagem && <p role="status" className="text-sm text-emerald-700">{mensagem}</p>}
      <button disabled={enviando || !arquivo} type="submit" className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{enviando ? "Cadastrando…" : "Cadastrar e enfileirar"}</button>
    </form>}
  </section>;
}
