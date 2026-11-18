import { z } from "zod";
import { periodoSkuSchema } from "./periodo";

export const SITUACOES_SKU = [
  { value: "8", label: "Dados incompletos" }, { value: "0", label: "Aberta" },
  { value: "3", label: "Aprovada" }, { value: "4", label: "Preparando envio" },
  { value: "1", label: "Faturada" }, { value: "7", label: "Pronto para envio" },
  { value: "5", label: "Enviada" }, { value: "6", label: "Entregue" },
  { value: "2", label: "Cancelada" }, { value: "9", label: "Não entregue" },
];
export const criarBuscaSkuSchema = z.object({
  chave: z.uuid(),
  situacoes: z.array(z.string().refine(s => SITUACOES_SKU.some(item => item.value === s)))
    .min(1).max(10).transform(itens => [...new Set(itens)].sort()),
  periodoInicio: z.string().optional(),
  periodoFim: z.string().optional(),
}).strict().superRefine((entrada, ctx) => {
  if (entrada.periodoInicio === undefined && entrada.periodoFim === undefined) return;
  const periodo = periodoSkuSchema.safeParse(entrada);
  if (!periodo.success) for (const issue of periodo.error.issues) ctx.addIssue(issue);
});
export type EntradaBuscaSku = z.infer<typeof criarBuscaSkuSchema>;
export type PedidoEncontradoSku = { id: string; dataCriacao: string | null };
export const acaoBuscaSkuSchema = z.object({ acao: z.enum(["retomar", "cancelar"]) }).strict();
export const ESTADOS_ABERTOS_SKU = ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY", "FALHOU"];
export type ItemSku = { sku: string; quantidade: number; tituloProduto?: string };
export type JobSkuResumo = {
  id: string; situacoes: string[]; status: string; etapa: string; passagem: number;
  periodoInicio: string | null; periodoFim: string | null; foraPeriodo: number;
  encontrados: number; processados: number; ignorados: number; tentativas: number;
  proximaTentativaEm: string; createdAt: string; updatedAt: string; finalizadoEm: string | null;
  erro: string | null; buscaId: string | null; resultadoRemovido: boolean; podeGerenciar: boolean;
};
export class ErroAnotarSku extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export class FalhaConsultaSku extends Error {
  constructor(readonly codigo: string, message: string, readonly temporaria: boolean, readonly retryAfterMs = 0) {
    super(message);
  }
}
export function atrasoRetrySku(tentativa: number, retryAfterMs = 0, aleatorio = Math.random()) {
  return Math.max(60_000 * 2 ** Math.max(0, Math.min(tentativa - 1, 3)), retryAfterMs) + Math.floor(aleatorio * 1000);
}

/** Mantém a regra atual: SKU preenchido e quantidade inteira positiva; soma dentro do pedido. */
export function agregarItensSku(itens: unknown[]): ItemSku[] {
  const totais = new Map<string, ItemSku>();
  for (const valor of itens) {
    if (!valor || typeof valor !== "object") continue;
    const item = valor as { produto?: { sku?: unknown; descricao?: unknown }; quantidade?: unknown };
    const sku = String(item.produto?.sku ?? "").trim();
    const quantidade = Number(item.quantidade);
    if (!sku || !Number.isInteger(quantidade) || quantidade <= 0) continue;
    const atual = totais.get(sku);
    const total = (atual?.quantidade ?? 0) + quantidade;
    if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
      throw new FalhaConsultaSku("QUANTIDADE_INVALIDA", "A Olist retornou uma quantidade fora do limite permitido.", false);
    }
    const tituloProduto = atual?.tituloProduto || (typeof item.produto?.descricao === "string" ? item.produto.descricao.trim() : "");
    totais.set(sku, { sku, quantidade: total, ...(tituloProduto ? { tituloProduto } : {}) });
  }
  return [...totais.values()];
}
