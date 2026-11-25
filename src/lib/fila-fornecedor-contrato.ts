import { z } from "zod";
import { dadosOlistFilaSchema } from "./fila-olist-contrato";
import { vendedorOrigemFilaSchema } from "./vendedor-fila-contrato";
import { referenciaPedidoManualSchema, fornecedorManualSchema } from "./pedido-manual-referencia";

export const direcionamentoPedidoManualSchema = z.object({
  inicial: z.object({
    tipo: z.enum(["REGRA", "PADRAO", "CONTA_UNICA"]),
    regraId: z.guid().nullable(),
    regraNome: z.string().trim().max(120).nullable(),
    versao: z.number().int().nonnegative().max(2147483647),
    aplicativoId: z.guid(),
    motivo: z.string().trim().min(1).max(500),
  }).strict(),
  alteracoes: z.array(z.object({
    usuarioId: z.guid(), em: z.iso.datetime(), anteriorId: z.guid(), aplicativoId: z.guid(),
  }).strict()).max(1000).default([]),
}).strict();

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
  olist: dadosOlistFilaSchema.optional(),
  vendedorOrigem: vendedorOrigemFilaSchema.optional(),
  itens: z.array(itemSchema).min(1),
  observacao: z.string().nullable().optional(),
  origemManual: referenciaPedidoManualSchema.optional(),
  fornecedorManual: fornecedorManualSchema.optional(),
  direcionamentoManual: direcionamentoPedidoManualSchema.optional(),
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
  solicitacaoProducaoId: string | null;
  tipoOrigem?: "PRODUCAO" | "MANUAL";
  autorNome?: string | null;
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
