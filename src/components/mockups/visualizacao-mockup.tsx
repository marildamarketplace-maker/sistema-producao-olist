"use client";

import { useEffect, useState } from "react";
import type { Mockup } from "@/lib/mockups";
import { mensagemMockups, requisitarMockups } from "@/lib/mockups-client";

export function VisualizacaoMockup({ mockup, token }: { mockup: Mockup; token: string }) {
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl("");
    setErro("");
    requisitarMockups(token, `?id=${encodeURIComponent(mockup.id)}`, { signal: controller.signal })
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
  }, [mockup.id, token, tentativa]);

  return (
    <div className="space-y-2">
      <h3 className="break-words text-sm font-medium">{mockup.nome}</h3>
      {erro ? (
        <>
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erro}</p>
          <button type="button" className={`min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium`} onClick={() => setTentativa((valor) => valor + 1)}>
            Recarregar imagem
          </button>
        </>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={mockup.nome} className="max-h-96 w-full rounded-md border border-slate-200 bg-slate-100 object-contain" />
      ) : (
        <p role="status" className="text-sm text-slate-600">Carregando imagem…</p>
      )}
    </div>
  );
}
