"use client";

import { useEffect, useRef, useState } from "react";

export function BuscaImagemEstampas({ token, foto, carregando, onFoto, onBuscar }: {
  token?: string; foto: File | null; carregando: boolean;
  onFoto: (foto: File | null) => void; onBuscar: () => void;
}) {
  const [habilitada, setHabilitada] = useState(false);
  const [erro, setErro] = useState("");
  const [preview, setPreview] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetch("/api/estampas/pesquisa-imagem", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => { if (response.ok) setHabilitada(Boolean((await response.json()).habilitada)); })
      .catch(() => {});
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (!foto) { setPreview(""); if (input.current) input.current.value = ""; return; }
    const url = URL.createObjectURL(foto);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);
  return <section aria-label="Buscar por imagem" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-slate-900">Buscar por imagem</h3>
    <p className="text-sm text-slate-600">Envie uma foto para encontrar estampas relacionadas por motivos, cores, tema e estilo. JPEG, PNG ou WebP, até 10 MB.</p>
    {!habilitada && <p role="status" className="text-sm text-slate-600">Busca por imagem em preparação. A pesquisa por texto continua disponível.</p>}
    <label className="block text-sm font-medium text-slate-700">Foto de referência
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={!habilitada || carregando}
        className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 p-2 text-sm disabled:opacity-50"
        onChange={event => {
          const file = event.target.files?.[0];
          setErro("");
          if (!file) return;
          if (file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setErro("Use JPEG, PNG ou WebP de até 10 MB."); event.target.value = ""; return;
          }
          onFoto(file);
        }} />
    </label>
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {foto && <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Foto local: object URL revogada ao trocar a referência. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="Foto de referência para a busca" className="h-32 w-32 rounded-md border border-slate-200 object-contain" />}
      <div className="min-w-0 space-y-2">
        <p className="break-all text-sm text-slate-600">{foto.name}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={carregando} onClick={onBuscar} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{carregando ? "Pesquisando…" : "Buscar estampas semelhantes"}</button>
          <button type="button" disabled={carregando} onClick={() => { onFoto(null); setErro(""); }} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Remover imagem</button>
        </div>
      </div>
    </div>}
    {foto && <p className="text-xs text-slate-600">A foto será analisada pela mesma IA usada no catálogo, sem cadastro no catálogo. A consulta expira em 30 minutos. Os filtros preenchidos serão obrigatórios.</p>}
  </section>;
}
