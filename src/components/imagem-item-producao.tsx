"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { carregarImagemProducao } from "@/lib/producao-imagem-carregamento";
import { X } from "lucide-react";

function ModalImagemProduto({ sku, url, onFechar }: { sku: string; url: string; onFechar: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const [erro, setErro] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={tituloId} aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onFechar(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onFechar(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id={tituloId} className="min-w-0 break-all text-lg font-semibold">{sku}</h2>
        <button type="button" onClick={onFechar} aria-label="Fechar imagem" autoFocus
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {erro ? <p role="alert" className="py-8 text-center text-sm text-red-700 dark:text-red-300">Não foi possível exibir a imagem. Feche e tente novamente.</p> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Produto ${sku}`} referrerPolicy="no-referrer" onError={() => setErro(true)} className="mx-auto max-h-[70dvh] max-w-full object-contain" />
      )}
    </dialog>, document.body,
  );
}

type Props = { sku: string; imagemUrl: string | null; endpoint: string; token?: string | null; compacta?: boolean };

export function ImagemItemProducao(props: Props) {
  return <ConteudoImagem key={JSON.stringify([props.endpoint, props.token, props.imagemUrl])} {...props} />;
}

function ConteudoImagem({ sku, imagemUrl, endpoint, token, compacta = false }: Props) {
  const [url, setUrl] = useState(imagemUrl);
  const [visualizando, setVisualizando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emAndamento = useRef(false);
  const elemento = useRef<HTMLDivElement>(null);
  const imagemInvalida = useRef<string | undefined>(undefined);
  const montado = useRef(true);
  const tentativaAutomatica = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  const carregar = useCallback(async (repetir = false) => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setCarregando(true);
    setErro(null);
    try {
      if (!token) throw new Error("Não foi possível validar o acesso. Reabra a página.");
      const novaUrl = await carregarImagemProducao(endpoint, token, imagemInvalida.current, repetir);
      if (montado.current) setUrl(novaUrl);
    } catch (error) {
      if (montado.current) setErro(error instanceof Error ? error.message : "Não foi possível carregar a imagem.");
    } finally { emAndamento.current = false; if (montado.current) setCarregando(false); }
  }, [endpoint, token]);
  useEffect(() => {
    const alvo = elemento.current;
    if (!alvo || imagemUrl || !token) return;
    const observer = new IntersectionObserver((entradas) => {
      if (!entradas.some((entrada) => entrada.isIntersecting) || tentativaAutomatica.current) return;
      tentativaAutomatica.current = true;
      observer.disconnect();
      void carregar();
    });
    observer.observe(alvo);
    return () => observer.disconnect();
  }, [carregar, token, imagemUrl]);
  const tamanho = compacta ? "h-14 w-14 rounded-xl" : "h-16 w-16 rounded-md";
  return <div ref={elemento} className="shrink-0">
    {url ? (
      <button type="button" onClick={() => setVisualizando(true)} aria-label={`Visualizar imagem de ${sku}`} title="Ampliar imagem"
        className={`${tamanho} block cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Produto ${sku}`} loading="lazy" referrerPolicy="no-referrer" className={`${tamanho} border border-slate-200 object-contain`} onError={() => { imagemInvalida.current = url; setUrl(null); setVisualizando(false); setErro("A imagem não abriu. Tente carregar novamente."); }} />
      </button>
    ) : erro ? <button type="button" onClick={() => void carregar(true)} disabled={carregando} aria-label={`Tentar carregar imagem de ${sku} novamente`} className={`${tamanho} flex items-center justify-center border border-slate-200 bg-slate-100 p-1 text-center text-[10px] font-medium text-slate-700 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50`}>
      Tentar novamente
    </button> : <div role="status" className={`${tamanho} flex items-center justify-center border border-slate-200 bg-slate-100 p-1 text-center text-[10px] text-slate-600`}>{carregando ? "Carregando..." : "Aguardando imagem..."}</div>}
    {visualizando && url && <ModalImagemProduto sku={sku} url={url} onFechar={() => setVisualizando(false)} />}
    {erro && <p role="status" className="mt-1 max-w-32 break-words text-xs text-red-700 dark:text-red-300">{erro}</p>}
  </div>;
}
