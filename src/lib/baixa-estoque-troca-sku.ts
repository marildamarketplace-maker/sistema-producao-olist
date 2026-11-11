/** Mantém o SKU vendido separado do SKU escolhido para a saída de estoque. */
export function prepararTrocaSkuBaixa<T extends {
  sku: string;
  skuOrigem?: string | null;
  pedidoOlistId?: string | null;
  itemOlistId?: string | null;
  observacao?: string | null;
}>(item: T) {
  const sku = item.sku.trim();
  const skuOrigem = item.skuOrigem?.trim() || sku;
  if (!sku || sku.length > 255 || skuOrigem.length > 255) {
    throw new Error("Informe um SKU válido com até 255 caracteres.");
  }
  const trocado = skuOrigem !== sku;
  if (trocado && (!item.pedidoOlistId?.trim() || !item.itemOlistId?.trim())) {
    throw new Error("A troca de SKU exige o pedido e o item original da Olist.");
  }
  const observacao = [item.observacao?.trim(), trocado ? `Troca de SKU na baixa: ${skuOrigem} → ${sku}.` : null]
    .filter(Boolean).join(" | ") || null;
  return { ...item, sku, skuOrigem, observacao };
}
