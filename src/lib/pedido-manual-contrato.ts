import { z } from "zod";
import { selecoesFilaOlistParciaisSchema } from "./fila-olist-contrato";
import type { DadosPedidoFila } from "./fila-fornecedor-contrato";
import { referenciaPedidoManualSchema } from "./pedido-manual-referencia";
import { decisaoDirecionamentoSchema } from "./direcionamento-pedidos-contrato";

const texto = z.string().trim().max(500);
export const itemPedidoManualSchema = z.object({
  id: z.guid(), tecidoNome: texto.min(1),
  quantidade: z.number().int().positive().max(2147483647),
  quantidadeTecido: z.number().min(0.000001).max(1e9),
  estampa: texto, variante: texto.nullable(), tamanho: texto, tipoProduto: texto,
  corteLaser: z.boolean(),
}).strict();
export type ItemPedidoManual = z.infer<typeof itemPedidoManualSchema>;
export const chavePedidoManualSchema = z.guid();
const camposPedidoManual = {
  chaveIdempotencia: chavePedidoManualSchema, aplicativoId: z.guid(),
  itens: z.array(itemPedidoManualSchema).min(1).max(100),
  observacao: z.string().trim().max(5000).nullable(),
  selecoes: selecoesFilaOlistParciaisSchema.refine(s => Boolean(s.clienteId && s.vendedorId), "Selecione vendedor e cliente."),
};
function validarItens(p: { itens: ItemPedidoManual[]; selecoes: z.infer<typeof selecoesFilaOlistParciaisSchema> }, ctx: z.RefinementCtx) {
  const ids = new Set(p.itens.map(i => i.id));
  const referencias = p.selecoes.tecidos ?? [];
  if (ids.size !== p.itens.length || new Set(referencias.map(t => t.tecidoId)).size !== referencias.length || referencias.some(t => !ids.has(t.tecidoId))) {
    ctx.addIssue({ code: "custom", message: "Os tecidos devem corresponder aos itens do pedido." });
  }
}
// O contrato anterior permite somente recuperar confirmações já aceitas.
export const pedidoManualLegadoSchema = z.object(camposPedidoManual).strict().superRefine(validarItens);
export const pedidoManualSchema = z.object({ ...camposPedidoManual, versao: z.literal(2),
  origemManual: referenciaPedidoManualSchema, decisaoDirecionamento: decisaoDirecionamentoSchema,
}).strict().superRefine(validarItens);
export type EntradaPedidoManual = z.infer<typeof pedidoManualSchema>;
export type EntradaPedidoManualLegada = z.infer<typeof pedidoManualLegadoSchema>;
export const resolucaoPedidoManualSchema = z.object({ referencia: referenciaPedidoManualSchema, decisao: decisaoDirecionamentoSchema,
  selecoes: z.object({clienteId:z.number().int().positive(),vendedorId:z.number().int().positive(),vendedorFixo:z.boolean()}).strict(),
}).strict();
export type ResolucaoPedidoManual = z.infer<typeof resolucaoPedidoManualSchema>;
export function montarDadosPedidoManual(p: EntradaPedidoManual): DadosPedidoFila {
  return { versao: 1, observacao: p.observacao, origemManual: p.origemManual,
    direcionamentoManual: { inicial: p.decisaoDirecionamento, alteracoes: [] },
    olist: { filialId: p.aplicativoId, selecoes: p.selecoes },
    itens: p.itens.map(i => ({ produtoId: i.id, sku: "", tecido: { id: i.id, nome: i.tecidoNome, referencia: null },
      quantidade: i.quantidade, unidade: "UN", quantidadeTecido: i.quantidadeTecido, unidadeTecido: "MT",
      estampa: i.estampa, variante: i.variante, tamanho: i.tamanho, tipoProduto: i.tipoProduto, corteLaser: i.corteLaser })) };
}
export const comprovantePedidoManualSchema = z.object({ id: z.guid(), status: z.string().min(1).max(40), createdAt: z.iso.datetime(),
  aplicativo: z.object({ id: z.guid(), nome: z.string() }).nullable(),
}).strict();
export type ComprovantePedidoManual = z.infer<typeof comprovantePedidoManualSchema>;
