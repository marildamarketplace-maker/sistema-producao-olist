import type { ResultadoPesquisaEstampasCatalogo } from "@/services/pesquisarEstampasCatalogoService";

/** Busca pelo código base exato, independentemente dos filtros da pesquisa principal. */
export async function buscarVariantesEstampa(
  entrada: { codigo: string; variante: string; pagina: number; token: string; signal: AbortSignal },
  requisitar: typeof fetch = fetch,
): Promise<ResultadoPesquisaEstampasCatalogo> {
  const params = new URLSearchParams({ codigo: entrada.codigo, pagina: String(entrada.pagina), porPagina: "24", ordenacao: "CODIGO_ASC" });
  if (entrada.variante.trim()) params.set("variante", entrada.variante.trim());
  const resposta = await requisitar(`/api/estampas/pesquisa?${params}`, {
    headers: { Authorization: `Bearer ${entrada.token}` }, cache: "no-store", signal: entrada.signal,
  });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.error ?? "Não foi possível buscar as variantes.");
  return dados;
}
