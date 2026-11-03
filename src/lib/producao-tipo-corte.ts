/** Infere apenas o marcador explícito do SKU, sem modificar o código original. */
export function tipoCorteDoSku(sku: string): "LASER" | null {
  return /(?:^|[-/])C\/LASER(?=[-/]|$)/i.test(sku) ? "LASER" : null;
}
