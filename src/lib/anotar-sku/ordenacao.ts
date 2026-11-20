export const COLUNAS_ORDENACAO_SKU = ["sku", "produto", "tecido", "quantidade"] as const;
export const DIRECOES_ORDENACAO_SKU = ["asc", "desc"] as const;
export type ColunaOrdenacaoSku = typeof COLUNAS_ORDENACAO_SKU[number];
export type OrdenacaoSku = { coluna: ColunaOrdenacaoSku; direcao: typeof DIRECOES_ORDENACAO_SKU[number] };
export type LinhaTabelaSku = { sku: string; produto: string | null; tecido?: string; quantidade: number };
export const ORDENACAO_SKU_PADRAO: OrdenacaoSku = { coluna: "quantidade", direcao: "desc" };

export function alternarOrdenacaoSku(atual: OrdenacaoSku, coluna: ColunaOrdenacaoSku): OrdenacaoSku {
  return { coluna, direcao: atual.coluna === coluna ? atual.direcao === "asc" ? "desc" : "asc" : coluna === "quantidade" ? "desc" : "asc" };
}

const compararTexto = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
function compararCampo(a: LinhaTabelaSku, b: LinhaTabelaSku, coluna: ColunaOrdenacaoSku) {
  if (coluna === "quantidade") return a.quantidade - b.quantidade;
  return compararTexto.compare(a[coluna] ?? "", b[coluna] ?? "");
}

/** Ordena somente resultados completos já carregados; páginas são ordenadas no banco. */
export function ordenarSkus<T extends LinhaTabelaSku>(itens: readonly T[], ordem: OrdenacaoSku): T[] {
  return [...itens].sort((a, b) => {
    const campoA = a[ordem.coluna], campoB = b[ordem.coluna];
    const vazioA = campoA === null || campoA === undefined || campoA === "";
    const vazioB = campoB === null || campoB === undefined || campoB === "";
    if (vazioA !== vazioB) return vazioA ? 1 : -1;
    return compararCampo(a, b, ordem.coluna) * (ordem.direcao === "asc" ? 1 : -1)
      || (a.produto ? b.produto ? compararTexto.compare(a.produto, b.produto) : -1 : b.produto ? 1 : 0)
      || compararTexto.compare(a.sku, b.sku) || a.sku.localeCompare(b.sku);
  });
}
