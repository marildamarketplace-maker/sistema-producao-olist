import { z } from "zod";

const DIA_MS = 86_400_000;
export const DIAS_PADRAO_SKU = 15;
export const MAX_DIAS_PERIODO_SKU = 366;
export type PeriodoSku = { periodoInicio: string; periodoFim: string };

export function hojeSku(referencia = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(referencia);
  const obter = (tipo: string) => partes.find(p => p.type === tipo)!.value;
  return `${obter("year")}-${obter("month")}-${obter("day")}`;
}
export function periodoPadraoSku(referencia = new Date()): PeriodoSku {
  const periodoFim = hojeSku(referencia);
  const periodoInicio = new Date(Date.parse(periodoFim) - (DIAS_PADRAO_SKU - 1) * DIA_MS).toISOString().slice(0, 10);
  return { periodoInicio, periodoFim };
}
export const periodoSkuSchema = z.object({
  periodoInicio: z.iso.date({ error: "Informe uma data inicial válida." }),
  periodoFim: z.iso.date({ error: "Informe uma data final válida." }),
}).superRefine((periodo, ctx) => {
  if (periodo.periodoInicio > periodo.periodoFim) ctx.addIssue({ code: "custom", path: ["periodoFim"], message: "A data final deve ser igual ou posterior à inicial." });
  if (periodo.periodoFim > hojeSku()) ctx.addIssue({ code: "custom", path: ["periodoFim"], message: "A data final não pode estar no futuro." });
  if (Date.parse(periodo.periodoFim) - Date.parse(periodo.periodoInicio) >= MAX_DIAS_PERIODO_SKU * DIA_MS) ctx.addIssue({ code: "custom", path: ["periodoFim"], message: `Escolha um período de até ${MAX_DIAS_PERIODO_SKU} dias.` });
});
export function dataIsoSku(data: Date | null | undefined) { return data?.toISOString().slice(0, 10) ?? null; }
export function formatarDiaSku(data: string) { return data.slice(0, 10).split("-").reverse().join("/"); }
export function descreverPeriodoSku(inicio?: string | null, fim?: string | null) {
  return inicio && fim ? `SKUs de pedidos criados de ${formatarDiaSku(inicio)} a ${formatarDiaSku(fim)}` : "Busca anterior, sem corte por data";
}

/** Datas sem fuso já representam o calendário da Olist; timestamps com fuso usam São Paulo. */
export function dataCriacaoPedidoSku(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  if (z.iso.date().safeParse(valor).success) return valor;
  const iso = valor.replace(" ", "T");
  if (!z.iso.datetime({ local: true, offset: true }).safeParse(iso).success) return null;
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? hojeSku(new Date(iso)) : iso.slice(0, 10);
}
