import { useEffect, useState } from "react";
import { MAX_ESTAMPAS_MOCKUPS, type EstampaSelecionadaMockup } from "@/lib/fila-mockups-contrato";

export function useSelecaoEstampasMockups(escopo: string | null) {
  const chave = escopo ? `estampas-mockups:${escopo}` : null;
  const [estado, setEstado] = useState<{ chave: string; itens: EstampaSelecionadaMockup[] } | null>(null);

  useEffect(() => {
    if (!chave) return;
    let itens: EstampaSelecionadaMockup[] = [];
    try {
      const salvo: unknown = JSON.parse(sessionStorage.getItem(chave) ?? "[]");
      if (Array.isArray(salvo)) {
        itens = salvo.filter((item): item is EstampaSelecionadaMockup =>
          item && typeof item.id === "string" && /^\d{1,19}$/.test(item.id) && typeof item.codigo === "string",
        ).slice(0, MAX_ESTAMPAS_MOCKUPS);
      }
    } catch { /* Armazenamento da aba indisponível. */ }
    setEstado({ chave, itens });
  }, [chave]);

  const pronto = Boolean(chave && estado?.chave === chave);
  const itens = pronto && estado ? estado.itens : [];
  function salvarSelecao(novos: EstampaSelecionadaMockup[]) {
    if (!chave) return false;
    setEstado({ chave, itens: novos });
    try {
      if (novos.length) sessionStorage.setItem(chave, JSON.stringify(novos));
      else sessionStorage.removeItem(chave);
      return true;
    } catch {
      return false;
    }
  }

  return { itens, pronto, salvarSelecao };
}
