"use client";

import { useRef, useState } from "react";

export function ImagemItemProducao({ sku, imagemUrl, endpoint, token, compacta = false }: {
  sku: string; imagemUrl: string | null; endpoint: string; token?: string | null; compacta?: boolean;
}) {
  const [url, setUrl] = useState(imagemUrl);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emAndamento = useRef(false);
  async function carregar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setCarregando(true);
    setErro(null);
    try {
      if (!token) throw new Error("Não foi possível validar o acesso. Reabra a página.");
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", referrerPolicy: "no-referrer" });
      const data = await response.json() as { imagemUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar a imagem.");
      if (!data.imagemUrl) throw new Error("Nenhuma imagem encontrada no Olist. Tente novamente mais tarde.");
      setUrl(data.imagemUrl);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar a imagem.");
    } finally { emAndamento.current = false; setCarregando(false); }
  }
  const tamanho = compacta ? "h-14 w-14 rounded-xl" : "h-16 w-16 rounded-md";
  return <div className="shrink-0">
    {url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={`Produto ${sku}`} loading="lazy" referrerPolicy="no-referrer" className={`${tamanho} border border-slate-200 object-contain`} onError={() => { setUrl(null); setErro("A imagem não abriu. Tente carregar novamente."); }} />
    ) : <button type="button" onClick={() => void carregar()} disabled={carregando} aria-label={`Carregar imagem de ${sku}`} className={`${tamanho} flex items-center justify-center border border-slate-200 bg-slate-100 p-1 text-center text-[10px] font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50`}>
      {carregando ? "Carregando..." : "Carregar Imagem"}
    </button>}
    {erro && <p role="status" className="mt-1 max-w-32 break-words text-xs text-red-700 dark:text-red-300">{erro}</p>}
  </div>;
}
