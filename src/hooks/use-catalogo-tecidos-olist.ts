"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { carregarLoteCatalogoTecidosOlist, chaveCatalogoTecidosOlist, type CatalogoTecidosOlist, type LoteCatalogoTecidosOlist } from "@/lib/catalogo-tecidos-olist";
import { consultarPaginaCatalogoTecidosOlist, PRAZO_PAGINA_CATALOGO_TECIDOS_MS } from "@/lib/consulta-catalogo-tecidos-olist";

type Registro = LoteCatalogoTecidosOlist & { chave: string; carregando: boolean; erro: string };
const vazio = (): LoteCatalogoTecidosOlist => ({ itens: [], proximaPagina: 1, completo: false });

/** Cache em memória da tela: nenhuma lista é compartilhada entre sessões ou usuários. */
export function useCatalogoTecidosOlist({ api, token, usuarioId, ativo, prazoPaginaMs = PRAZO_PAGINA_CATALOGO_TECIDOS_MS }: {
  api: string | null; token: string; usuarioId: string; ativo: boolean; prazoPaginaMs?: number;
}): CatalogoTecidosOlist {
  const chave = api ? chaveCatalogoTecidosOlist(api, usuarioId, token) : "";
  const contexto = useRef({ api, token, chave, ativo, prazoPaginaMs });
  contexto.current = { api, token, chave, ativo, prazoPaginaMs };
  const registroAtual = useRef<Registro | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [registro, setRegistro] = useState<Registro | null>(null);

  const carregar = useCallback(async (reiniciar = false) => {
    const inicial = contexto.current;
    if (!inicial.ativo || !inicial.api || !inicial.chave) return;
    if (controller.current && !controller.current.signal.aborted && registroAtual.current?.carregando) return;
    controller.current?.abort();
    const atual = new AbortController();
    controller.current = atual;
    const anterior = !reiniciar && registroAtual.current?.chave === inicial.chave ? registroAtual.current : vazio();
    const vigente = () => !atual.signal.aborted && controller.current === atual && contexto.current.ativo && contexto.current.chave === inicial.chave;
    const publicar = (lote: LoteCatalogoTecidosOlist, carregando: boolean, erro = "") => {
      if (!vigente()) return;
      const proximo: Registro = { ...lote, chave: inicial.chave, carregando, erro };
      registroAtual.current = proximo;
      setRegistro(proximo);
    };
    publicar(anterior, true);
    try {
      const lote = await carregarLoteCatalogoTecidosOlist({ anterior, signal: atual.signal,
        carregar: async pagina => {
          atual.signal.throwIfAborted();
          // Uma renovação de contexto durante a carga usa a URL autorizada mais recente.
          const apiAtual = contexto.current.api;
          if (!apiAtual || !vigente()) throw new DOMException("Consulta cancelada.", "AbortError");
          const separador = apiAtual.includes("?") ? "&" : "?";
          return consultarPaginaCatalogoTecidosOlist(async signal => {
            const response = await fetch(`${apiAtual}${separador}${new URLSearchParams({ recurso: "produtos", busca: "ref", pagina: String(pagina) })}`, {
              headers: { Authorization: `Bearer ${inicial.token}` }, signal, cache: "no-store",
            });
            const payload: unknown = await response.json();
            if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "Não foi possível carregar os produtos da Olist.");
            return payload;
          }, atual.signal, contexto.current.prazoPaginaMs);
        },
        aoCarregar: lote => publicar(lote, true),
      });
      publicar(lote, false);
    } catch (error) {
      if (vigente()) publicar(registroAtual.current?.chave === inicial.chave ? registroAtual.current : anterior, false,
        error instanceof Error ? error.message : "Falha ao carregar os produtos da Olist.");
    }
  }, []);

  const cancelar = useCallback(() => {
    const atual = registroAtual.current;
    if (!contexto.current.ativo || !atual?.carregando || atual.chave !== contexto.current.chave) return;
    controller.current?.abort();
    const interrompido = { ...atual, carregando: false, erro: "Carregamento cancelado. Tente novamente para continuar." };
    registroAtual.current = interrompido;
    setRegistro(interrompido);
  }, []);

  useEffect(() => {
    controller.current?.abort();
    if (!ativo || !chave) return;
    const atual = registroAtual.current;
    if (atual?.chave !== chave || atual.carregando) void carregar();
    // Listas completas, parciais e erros só são recarregados por ação explícita.
    return () => controller.current?.abort();
  }, [ativo, chave, carregar]);

  const visivel = ativo && registro?.chave === chave ? registro : null;
  return {
    itens: visivel?.itens ?? [], carregando: visivel?.carregando ?? Boolean(ativo && chave),
    completo: visivel?.completo ?? false, erro: visivel?.erro ?? "",
    carregarMais: () => { void carregar(); }, atualizar: () => { void carregar(true); }, cancelar,
  };
}
