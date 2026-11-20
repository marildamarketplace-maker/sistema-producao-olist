"use client";
import { useCallback, useEffect, useState } from "react";
import { TIPO_RELATORIO_SKU, type TrabalhoIaResumo } from "@/lib/trabalhos-ia/contrato";

export const trabalhoIaAtivo = (t?: TrabalhoIaResumo) => Boolean(t && ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"].includes(t.status));
export async function requisicaoIa<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: init.signal ?? AbortSignal.timeout(30_000) });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível concluir a operação.");
  return dados as T;
}
export function useTrabalhosIa(token: string, origens: string[]) {
  const [trabalhos, setTrabalhos] = useState<TrabalhoIaResumo[]>([]), [erro, setErro] = useState<string | null>(null), [versao, setVersao] = useState(0);
  const ids = JSON.stringify(origens);
  const atualizar = useCallback(() => setVersao(v => v + 1), []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, rodando = false, falhas = 0;
    const lista = JSON.parse(ids) as string[];
    async function consultar() {
      if (rodando || controller.signal.aborted || document.visibilityState === "hidden") return;
      clearTimeout(timer); rodando = true;
      try {
        const todos: TrabalhoIaResumo[] = [];
        for (let i = 0; i < lista.length; i += 50) {
          const query = new URLSearchParams({ tipo: TIPO_RELATORIO_SKU });
          lista.slice(i, i + 50).forEach(id => query.append("origem", id));
          const dados = await requisicaoIa<{ trabalhos: TrabalhoIaResumo[] }>(token, `/api/trabalhos-ia?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
          todos.push(...dados.trabalhos);
        }
        if (controller.signal.aborted) return;
        setTrabalhos(todos); setErro(null); falhas = 0;
        if (todos.some(trabalhoIaAtivo)) timer = setTimeout(consultar, 10_000);
      } catch (e) {
        if (!controller.signal.aborted) {
          setErro(e instanceof Error ? e.message : "Falha ao acompanhar relatórios.");
          timer = setTimeout(consultar, Math.min(60_000, 10_000 * 2 ** Math.min(falhas++, 3)));
        }
      } finally { rodando = false; }
    }
    void consultar();
    const visivel = () => { if (document.visibilityState === "visible") void consultar(); else clearTimeout(timer); };
    window.addEventListener("focus", visivel); document.addEventListener("visibilitychange", visivel);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", visivel); document.removeEventListener("visibilitychange", visivel); };
  }, [token, ids, versao]);
  return { trabalhos, erro, atualizar };
}
