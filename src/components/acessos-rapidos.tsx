"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAuth } from "./auth-provider";
import { rankingPaginas, type ContagemPagina } from "@/lib/navigation";

export function AcessosRapidos() {
  const { usuario, session, loading } = useAuth();
  const [resultado, setResultado] = useState<{ usuarioId: string; contagens: ContagemPagina[] } | null>(null);
  const [estado, setEstado] = useState("Carregando seu ranking...");
  const [tentativa, setTentativa] = useState(0);
  const token = session?.access_token;
  const usuarioId = usuario?.id;
  useEffect(() => {
    if (!usuarioId || !token) return;
    const controller = new AbortController();
    setEstado("Carregando seu ranking...");
    void fetch("/api/acessos-paginas", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { paginas: { href: string; acessos: number }[] };
        if (controller.signal.aborted) return;
        setResultado({ usuarioId, contagens: data.paginas.map((p) => ({ pagina: p.href, acessos: p.acessos })) });
        setEstado("");
      }).catch(() => { if (!controller.signal.aborted) setEstado("Ranking indisponível. Você pode continuar usando os atalhos."); });
    return () => controller.abort();
  }, [usuarioId, token, tentativa]);
  if (!usuario) return loading ? <p role="status" className="mb-6 text-sm text-slate-600">Carregando acessos rápidos...</p> : null;
  const paginas = rankingPaginas(usuario, resultado?.usuarioId === usuario.id ? resultado.contagens : []);
  return (
    <section aria-labelledby="acessos-rapidos-titulo" className="mb-6 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h2 id="acessos-rapidos-titulo" className="text-2xl font-semibold text-slate-900">Acessos rápidos</h2>
      <p className="mt-2 text-sm text-slate-600">Suas telas mais acessadas aparecem primeiro.</p>
      {estado && <p role="status" className="mt-3 text-sm text-slate-600">{estado}</p>}
      {estado.startsWith("Ranking indisponível") && <button type="button" onClick={() => setTentativa((n) => n + 1)} className="mt-2 min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm focus-visible:ring-2 focus-visible:ring-slate-500">Tentar novamente</button>}
      {paginas.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nenhuma tela disponível.</p> : (
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {paginas.map((pagina) => <li key={pagina.href} className="min-w-0">
            <Link href={pagina.href} className="flex min-h-11 h-full items-center justify-between gap-3 rounded-md border border-slate-200 p-4 text-sm transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
              <span className="min-w-0 break-words"><span className="block text-xs text-slate-500">{pagina.grupo}</span><span className="mt-1 block font-medium text-slate-900">{pagina.label}</span><span className="mt-1 block text-xs text-slate-600">{resultado?.usuarioId === usuario.id ? `${pagina.acessos} ${pagina.acessos === 1 ? "acesso" : "acessos"}` : "Acessos ainda não carregados"}</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            </Link>
          </li>)}
        </ol>
      )}
    </section>
  );
}
