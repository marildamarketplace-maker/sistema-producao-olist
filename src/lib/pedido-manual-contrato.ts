import { z } from "zod";
import { selecoesFilaOlistParciaisSchema } from "./fila-olist-contrato";
import type { DadosPedidoFila } from "./fila-fornecedor-contrato";
import { referenciaPedidoManualSchema, fornecedorManualSchema } from "./pedido-manual-referencia";
import { decisaoDirecionamentoSchema } from "./direcionamento-pedidos-contrato";

const texto = z.string().trim().max(500);
export const itemPedidoManualSchema = z.object({
  id: z.guid(), tecidoNome: texto.min(1, "Informe o tecido."),
  quantidade: z.number().int("Informe peças inteiras.").nonnegative().max(2147483647),
  quantidadeTecido: z.number().min(0.000001, "Informe uma metragem positiva.").max(1e9),
  estampa: texto, variante: texto.nullable(), tamanho: texto, tipoProduto: texto,
  corteLaser: z.boolean(),
  modalidade: z.enum(["TECIDO_LISO", "TECIDO_SUBLIMADO", "PRODUTO_SUBLIMADO"]).optional(),
  grupoId: z.guid().optional(),
  tamanhoId: z.guid().nullable().optional(),
  modoMetragem: z.enum(["AUTOMATICA", "MANUAL"]).optional(),
  consumoUnidade: z.number().positive().max(1e9).nullable().optional(),
  revisarMetragem: z.boolean().optional(),
}).strict().superRefine((item, ctx) => {
  const erro = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (!item.modalidade || item.modalidade === "PRODUTO_SUBLIMADO") {
    if (item.quantidade < 1) erro("quantidade", "Informe a quantidade de peças.");
  } else {
    if (item.quantidade !== 0) erro("quantidade", "Tecido corrido usa somente metros.");
    if (item.corteLaser || item.tamanho || item.tipoProduto || item.tamanhoId || item.modoMetragem === "AUTOMATICA") erro("modalidade", "Tecido corrido não possui tamanho, tipo de produto ou laser.");
    if (item.modalidade === "TECIDO_LISO" && (item.estampa || item.variante)) erro("estampa", "Tecido sem estampa não possui variante.");
  }
  if (item.modalidade && item.modalidade !== "TECIDO_LISO") {
    if (!item.estampa) erro("estampa", "Informe a estampa.");
    if (!item.variante) erro("variante", "Informe a variante.");
  }
  if (item.modalidade === "PRODUTO_SUBLIMADO") {
    if (!item.tamanho) erro("tamanho", "Informe o tamanho.");
    if (!item.tipoProduto) erro("tipoProduto", "Informe o tipo de produto.");
  }
  if (item.modoMetragem === "AUTOMATICA" && (!item.tamanhoId || !item.consumoUnidade)) erro("tamanhoId", "Selecione um tamanho com consumo válido.");
  if (item.revisarMetragem) erro("quantidadeTecido", "Revise a metragem ajustada após alterar as peças.");
});
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
  fornecedorManual: fornecedorManualSchema.optional(),
}).strict().superRefine(validarItens);
export type EntradaPedidoManual = z.infer<typeof pedidoManualSchema>;
export type EntradaPedidoManualLegada = z.infer<typeof pedidoManualLegadoSchema>;
export const resolucaoPedidoManualSchema = z.object({ referencia: referenciaPedidoManualSchema, decisao: decisaoDirecionamentoSchema,
  fornecedorManual: fornecedorManualSchema.optional(),
  aplicativoDestino: z.object({ id: z.guid(), nome: z.string().min(1) }).strict().optional(),
  selecoes: z.object({clienteId:z.number().int().positive(),vendedorId:z.number().int().positive(),vendedorFixo:z.boolean()}).strict(),
}).strict();
export type ResolucaoPedidoManual = z.infer<typeof resolucaoPedidoManualSchema>;
export function montarDadosPedidoManual(p: EntradaPedidoManual): DadosPedidoFila {
  return { versao: 1, observacao: p.observacao, origemManual: p.origemManual,
    ...(p.fornecedorManual ? { fornecedorManual: p.fornecedorManual } : {}),
    direcionamentoManual: { inicial: p.decisaoDirecionamento, alteracoes: [] },
    olist: { filialId: p.aplicativoId, selecoes: p.selecoes },
    itens: p.itens.map(i => ({
      ...(i.modalidade ? { modalidade: i.modalidade } : {}),
      ...(i.modoMetragem ? { modoMetragem: i.modoMetragem, consumoUnidade: i.consumoUnidade ?? null } : {}),
      produtoId: i.id, sku: "", tecido: { id: i.id, nome: i.tecidoNome, referencia: null },
      quantidade: i.modalidade && i.modalidade !== "PRODUTO_SUBLIMADO" ? i.quantidadeTecido : i.quantidade, unidade: i.modalidade && i.modalidade !== "PRODUTO_SUBLIMADO" ? "MT" : "UN", quantidadeTecido: i.quantidadeTecido, unidadeTecido: "MT",
      estampa: i.estampa, variante: i.variante, tamanho: i.tamanho, tipoProduto: i.tipoProduto, corteLaser: i.corteLaser })) };
}
export const comprovantePedidoManualSchema = z.object({ id: z.guid(), status: z.string().min(1).max(40), createdAt: z.iso.datetime(),
  aplicativo: z.object({ id: z.guid(), nome: z.string() }).nullable(),
  filaExterna: z.boolean().optional(),
}).strict();
export type ComprovantePedidoManual = z.infer<typeof comprovantePedidoManualSchema>;
