import { z } from "zod";

export class RetornoOlistError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export const buscaRetornoSchema = z.object({
  data_atualizacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Data inválida.").optional(),
}).strict();

export const confirmarRetornoSchema = z.object({
  chave_idempotencia: z.uuid().transform((value) => value.toLowerCase()),
  itens: z.array(z.object({
    item_baixa_id: z.uuid().transform((value) => value.toLowerCase()),
    quantidade: z.number().int().min(0).max(2147483647),
    perdido_na_entrega: z.literal(true).optional(),
  }).strict()).min(1).max(500),
}).strict();
export type ConfirmarRetornoInput = z.infer<typeof confirmarRetornoSchema>;

export function normalizarItensRetorno(input: ConfirmarRetornoInput) {
  const ids = new Set<string>();
  for (const item of input.itens) {
    if (ids.has(item.item_baixa_id)) throw new RetornoOlistError("Baixa repetida na confirmação.");
    ids.add(item.item_baixa_id);
  }
  const itens = input.itens.filter((item) => item.quantidade > 0)
    .sort((a, b) => a.item_baixa_id.localeCompare(b.item_baixa_id));
  if (!itens.length) throw new RetornoOlistError("Informe ao menos uma quantidade maior que zero.");
  return itens;
}

export type BaixaRetorno = {
  id: string; aplicativoId: string | null; produtoId: string | null; sku: string;
  quantidade: number; pedidoOlistId: string | null; movimentacaoId: string | null;
  retornos: { quantidade: number }[];
};
export type SaidaRetorno = {
  id: string; aplicativoId: string | null; produtoId: string; sku: string;
  quantidade: number; tipoMovimento: string;
};
export type ItemRetornoRevisao = {
  item_baixa_id: string; sku: string; quantidade_baixada: number;
  quantidade_retornada: number; saldo: number;
};
export type PedidoRetornoRevisao = {
  id: string; estado: "elegivel" | "sem_baixa" | "retornado" | "pendente";
  motivo?: string; itens: ItemRetornoRevisao[];
};
export type ResultadoBuscaRetorno = {
  data_atualizacao: string; pedidos: PedidoRetornoRevisao[];
};
export type HistoricoRetorno = {
  id: string; created_at: string; responsavel: string;
  itens: { pedido_olist_id: string | null; sku: string; quantidade: number; perdido_na_entrega?: boolean }[];
};

export function revisarBaixaRetorno(baixa: BaixaRetorno, saida: SaidaRetorno | undefined, aplicativoId: string): ItemRetornoRevisao {
  if (baixa.aplicativoId !== aplicativoId || !baixa.pedidoOlistId || !baixa.produtoId || !baixa.sku.trim()
    || !Number.isSafeInteger(baixa.quantidade) || baixa.quantidade <= 0
    || !saida || saida.id !== baixa.movimentacaoId || saida.aplicativoId !== aplicativoId
    || saida.tipoMovimento !== "saida" || saida.produtoId !== baixa.produtoId
    || saida.sku !== baixa.sku || saida.quantidade !== baixa.quantidade) {
    throw new RetornoOlistError("Baixa sem vínculo confiável com a movimentação de saída.", 409);
  }
  const retornada = baixa.retornos.reduce((total, item) => total + item.quantidade, 0);
  if (!Number.isSafeInteger(retornada) || retornada < 0 || retornada > baixa.quantidade) {
    throw new RetornoOlistError("Histórico de retornos inconsistente. Revise a baixa.", 409);
  }
  return { item_baixa_id: baixa.id, sku: baixa.sku, quantidade_baixada: baixa.quantidade,
    quantidade_retornada: retornada, saldo: baixa.quantidade - retornada };
}

export function validarPedidoCancelado(detalhe: Record<string, unknown>, skus: string[]) {
  // Situação ausente/desconhecida nunca autoriza uma entrada.
  if (!detalhe || typeof detalhe !== "object" || String(detalhe.situacao) !== "2") {
    throw new RetornoOlistError("O pedido não está mais cancelado ou seu status não pôde ser confirmado.", 409);
  }
  const itens = Array.isArray(detalhe.itens) ? detalhe.itens : [];
  const skusVendidos = new Set(itens.map((item: { produto?: { sku?: unknown } }) => String(item?.produto?.sku ?? "").trim()));
  if (skus.some((sku) => !skusVendidos.has(sku))) {
    throw new RetornoOlistError("SKU da baixa não corresponde aos itens atuais do pedido Olist.", 409);
  }
}
