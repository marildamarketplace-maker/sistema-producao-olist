import { z } from "zod";

const itemSchema = z.object({
  produtoId: z.string(),
  sku: z.string(),
  tecido: z.object({ id: z.string(), nome: z.string(), referencia: z.string().nullable() }),
  quantidade: z.number().positive(),
  unidade: z.literal("UN"),
  quantidadeTecido: z.number().positive(),
  unidadeTecido: z.literal("MT"),
  estampa: z.string(),
  variante: z.string().nullable(),
  corteLaser: z.boolean(),
  tamanho: z.string(),
  tipoProduto: z.string(),
});

export const dadosPedidoFilaSchema = z.object({
  versao: z.literal(1),
  itens: z.array(itemSchema).min(1),
  observacao: z.string().nullable().optional(),
});

export type DadosPedidoFila = z.infer<typeof dadosPedidoFilaSchema>;
export type FilialFila = { id: string; nome: string };
export type PedidoFilaAdministracao = {
  id: string;
  solicitacaoProducaoId: string;
  createdAt: string;
  origem: string;
  filial: FilialFila | null;
  direcionadoEm: string | null;
  versao: number;
  dadosPedido: DadosPedidoFila | null;
};
export type ListaFilaAdministracao = {
  pedidos: PedidoFilaAdministracao[];
  filiais: FilialFila[];
  total: number;
  pagina: number;
  porPagina: number;
};
export type SituacaoFila = "pendente" | "direcionado" | "todos";
