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
export const statusFilaValores = ["PENDENTE", "PROCESSAR", "CONCLUIDO", "FALHADO", "CANCELADO"] as const;
export type StatusFila = typeof statusFilaValores[number];
export const rotulosStatusFila: Record<StatusFila, string> = {
  PENDENTE: "PENDENTE", PROCESSAR: "PROCESSAR", CONCLUIDO: "CONCLUIDO", FALHADO: "FALHADO", CANCELADO: "CANCELADO",
};
export const filtrosStatusFila = {
  pendente: "PENDENTE", processar: "PROCESSAR", concluido: "CONCLUIDO", falhado: "FALHADO", cancelado: "CANCELADO",
} as const;
export type PedidoFilaAdministracao = {
  status: StatusFila;
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
export type SituacaoFila = keyof typeof filtrosStatusFila | "direcionado" | "todos";

export type ResumoFilaProducao = { id: string; solicitacaoProducaoId: string; status: StatusFila };
export type DetalheFilaProducao = ResumoFilaProducao & {
  fornecedor: string; filial: FilialFila | null; createdAt: string; direcionadoEm: string | null;
  dadosPedido: DadosPedidoFila | null;
};
