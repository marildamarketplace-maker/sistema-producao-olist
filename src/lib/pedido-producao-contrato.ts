import { z } from "zod";
import { itemPedidoManualSchema, pedidoManualSchema } from "./pedido-manual-contrato";

/** Mantém o contrato de linhas do editor compartilhado, com o limite de produção. */
export const pedidoProducaoSchema = pedidoManualSchema.safeExtend({
  itens: z.array(itemPedidoManualSchema).min(1).max(1000),
  revisaoProducao: z.string().regex(/^[a-f0-9]{64}$/),
});
export type EntradaPedidoProducao = z.infer<typeof pedidoProducaoSchema>;
export const origemPedidoProducaoSchema = z.object({
  itens: z.array(itemPedidoManualSchema.safeExtend({ tecidoNome: z.string().max(500), quantidadeTecido: z.number().nonnegative() })).min(1).max(1000),
  observacao: z.string().nullable(),
  revisao: z.string().regex(/^[a-f0-9]{64}$/),
  revisaoFonte: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type OrigemPedidoProducao = z.infer<typeof origemPedidoProducaoSchema>;
