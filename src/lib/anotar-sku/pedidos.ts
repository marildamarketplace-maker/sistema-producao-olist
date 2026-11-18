import { z } from "zod";

export const LIMITE_PEDIDOS_SKU = 50;
export const consultaPedidosSkuSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1).max(512),
  cursor: z.string().min(1).max(128).optional(),
});

export const paginaPedidosSkuSchema = z.object({
  pedidos: z.array(z.object({ id: z.string(), quantidade: z.number().int() })).max(LIMITE_PEDIDOS_SKU),
  proximoCursor: z.string().nullable(),
});
export type PaginaPedidosSku = z.infer<typeof paginaPedidosSkuSchema>;
export const consultaForaPeriodoSkuSchema = consultaPedidosSkuSchema.omit({ sku: true });
export const paginaForaPeriodoSkuSchema = z.object({
  pedidos: z.array(z.object({ id: z.string(), dataCriacao: z.iso.date().nullable() })).max(LIMITE_PEDIDOS_SKU),
  proximoCursor: z.string().nullable(),
});
export type PaginaForaPeriodoSku = z.infer<typeof paginaForaPeriodoSkuSchema>;

export function linkPedidoOlist(id: string) {
  return `https://erp.olist.com/vendas#edit/${encodeURIComponent(id)}`;
}
