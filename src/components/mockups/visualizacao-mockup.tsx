"use client";

import { useEffect, useRef, useState } from "react";
import type { Mockup } from "@/lib/mockups";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";

export function VisualizacaoMockup({ mockup, token }: { mockup: Mockup; token: string }) {
  return <ImagemPrivadaMockup nome={mockup.nome} token={token} rota={`?id=${encodeURIComponent(mockup.id)}`} />;
}

export function ImagemPrivadaMockup({ nome, token, rota, arquivo, miniatura = false }: {
  nome: string;
  token: string;
  rota: string;
  arquivo?: string;
  miniatura?: boolean;
}) {
  const quadro = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(!miniatura);
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (visivel || !quadro.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisivel(true);
      return;
    }
    const observer = new IntersectionObserver(([entrada]) => {
      if (!entrada.isIntersecting) return;
      setVisivel(true);
      observer.disconnect();
    }, { rootMargin: "200px" });
    observer.observe(quadro.current);
    return () => observer.disconnect();
  }, [visivel]);

  useEffect(() => {
    if (!visivel) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl("");
    setErro("");
    requisitarMockups(token, rota, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setErro(mensagemMockups(error));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rota, token, tentativa, visivel]);

  return (
    <div ref={quadro} className={miniatura
      ? "flex aspect-square w-full min-w-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100"
      : "space-y-2"}>
      {!miniatura && <h3 className="break-words text-sm font-medium">{nome}</h3>}
      {erro ? (
        <div className={miniatura ? "space-y-2 p-3 text-center" : "space-y-2"}>
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>
          <button type="button" className={`min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium`} onClick={() => setTentativa((valor) => valor + 1)}>
            Recarregar imagem
          </button>
        </div>
      ) : url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={nome} className={miniatura ? "h-full w-full rounded-md object-contain"
            : "max-h-96 w-full rounded-md border border-slate-200 bg-slate-100 object-contain"} />
          {arquivo && <a href={url} download={arquivo}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100">
            Baixar WebP
          </a>}
        </>
      ) : (
        <p role={miniatura ? undefined : "status"} className="px-3 text-center text-sm text-slate-600">{visivel ? "Carregando imagem…" : "Prévia da imagem"}</p>
      )}
    </div>
  );
}
