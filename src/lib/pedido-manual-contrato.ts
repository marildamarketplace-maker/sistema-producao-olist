import { z } from "zod";
import { selecoesFilaOlistParciaisSchema } from "./fila-olist-contrato";
import type { DadosPedidoFila } from "./fila-fornecedor-contrato";

const texto = z.string().trim().max(500);
export const itemPedidoManualSchema = z.object({
  id: z.guid(), tecidoNome: texto.min(1),
  quantidade: z.number().int().positive().max(2147483647),
  quantidadeTecido: z.number().min(0.000001).max(1e9),
  estampa: texto, variante: texto.nullable(), tamanho: texto, tipoProduto: texto,
  corteLaser: z.boolean(),
}).strict();
export type ItemPedidoManual = z.infer<typeof itemPedidoManualSchema>;
export const pedidoManualSchema = z.object({
  chaveIdempotencia: z.guid(), aplicativoId: z.guid(),
  itens: z.array(itemPedidoManualSchema).min(1).max(100),
  observacao: z.string().trim().max(5000).nullable(),
  selecoes: selecoesFilaOlistParciaisSchema.refine(s => Boolean(s.clienteId && s.vendedorId), "Selecione vendedor e cliente."),
}).strict().superRefine((p, ctx) => {
  const ids = new Set(p.itens.map(i => i.id));
  const referencias = p.selecoes.tecidos ?? [];
  if (ids.size !== p.itens.length || new Set(referencias.map(t => t.tecidoId)).size !== referencias.length || referencias.some(t => !ids.has(t.tecidoId))) {
    ctx.addIssue({ code: "custom", message: "Os tecidos devem corresponder aos itens do pedido." });
  }
});
export type EntradaPedidoManual = z.infer<typeof pedidoManualSchema>;
export function montarDadosPedidoManual(p: EntradaPedidoManual): DadosPedidoFila {
  return { versao: 1, observacao: p.observacao, olist: { filialId: p.aplicativoId, selecoes: p.selecoes },
    itens: p.itens.map(i => ({ produtoId: i.id, sku: "", tecido: { id: i.id, nome: i.tecidoNome, referencia: null },
      quantidade: i.quantidade, unidade: "UN", quantidadeTecido: i.quantidadeTecido, unidadeTecido: "MT",
      estampa: i.estampa, variante: i.variante, tamanho: i.tamanho, tipoProduto: i.tipoProduto, corteLaser: i.corteLaser })) };
}
export type ComprovantePedidoManual = { id: string; status: string; createdAt: string; aplicativo: { id: string; nome: string } | null };
