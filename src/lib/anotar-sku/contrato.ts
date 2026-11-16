import { z } from "zod";

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
}).strict();
export const acaoBuscaSkuSchema = z.object({ acao: z.enum(["retomar", "cancelar"]) }).strict();
export const ESTADOS_ABERTOS_SKU = ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY", "FALHOU"];
export type ItemSku = { sku: string; quantidade: number };
export type JobSkuResumo = {
  id: string; situacoes: string[]; status: string; etapa: string; passagem: number;
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
  const totais = new Map<string, number>();
  for (const valor of itens) {
    if (!valor || typeof valor !== "object") continue;
    const item = valor as { produto?: { sku?: unknown }; quantidade?: unknown };
    const sku = String(item.produto?.sku ?? "").trim();
    const quantidade = Number(item.quantidade);
    if (!sku || !Number.isInteger(quantidade) || quantidade <= 0) continue;
    const total = (totais.get(sku) ?? 0) + quantidade;
    if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
      throw new FalhaConsultaSku("QUANTIDADE_INVALIDA", "A Olist retornou uma quantidade fora do limite permitido.", false);
    }
    totais.set(sku, total);
  }
  return [...totais].map(([sku, quantidade]) => ({ sku, quantidade }));
}
