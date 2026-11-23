import { createHash } from "node:crypto";
import { z } from "zod";
import type { EntidadeSync } from "./contrato";
import { VERSAO_OBSERVACAO_CONTATO } from "./tipos-contato";
import { VERSAO_IDENTIDADE_CONTATO } from "./dominio";

export const VERSAO_CONTRATO_INCREMENTAL = 1;
export const SOBREPOSICAO_INCREMENTAL_MS = 24 * 60 * 60 * 1000;
export const INTERVALO_COMPLETA_MS = 15 * 24 * 60 * 60 * 1000;

const instante = z.string().datetime({ offset: true });
const planoSchema = z.object({
  modo: z.enum(["COMPLETA", "INCREMENTAL"]),
  iniciadaEm: instante,
  desde: z.string().nullable(),
  desdeUtc: instante.nullable(),
  watermarkAnterior: instante.nullable(),
  geracao: z.number().int().nonnegative(),
  assinaturaEscopo: z.string().min(1),
  contaIdentidade: z.string().min(1),
  fuso: z.string().nullable(),
  versaoContrato: z.literal(VERSAO_CONTRATO_INCREMENTAL),
});
export type PlanoColetaSync = z.infer<typeof planoSchema>;

export function fusoIncrementalValido(fuso: string): boolean {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: fuso }).format(0); return true; }
  catch { return false; }
}

export function lerPlanoColeta(valor: unknown): PlanoColetaSync | null {
  const resultado = planoSchema.safeParse(valor);
  if (!resultado.success) return null;
  const plano = resultado.data;
  if (plano.watermarkAnterior && new Date(plano.watermarkAnterior) > new Date(plano.iniciadaEm)) return null;
  if (plano.modo === "INCREMENTAL") {
    if (!plano.desde || !plano.desdeUtc || !plano.watermarkAnterior || !plano.fuso || !fusoIncrementalValido(plano.fuso)) return null;
    const desde = new Date(plano.desdeUtc), anterior = new Date(plano.watermarkAnterior);
    if (anterior.getTime() - desde.getTime() !== SOBREPOSICAO_INCREMENTAL_MS || formatarDesdeIncremental(desde, plano.fuso) !== plano.desde) return null;
  } else if (plano.desde !== null || plano.desdeUtc !== null || plano.fuso !== null) return null;
  return plano;
}

// Horários, permissões e limites não mudam a semântica dos snapshots coletados.
export function assinaturaEscopoSync(entidade: EntidadeSync, participantesIds: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify({ contrato: VERSAO_CONTRATO_INCREMENTAL, entidade, ...(entidade === "CONTATO" ? { projecaoContato: VERSAO_OBSERVACAO_CONTATO, identidadeContato: VERSAO_IDENTIDADE_CONTATO } : {}),
    participantes: [...new Set(participantesIds)].sort() })).digest("hex");
}

// O fuso pertence à validação da API, não é inferido do fuso da agenda.
export function formatarDesdeIncremental(data: Date, fuso: string): string {
  if (!Number.isFinite(data.getTime()) || !fusoIncrementalValido(fuso)) throw new Error("Janela incremental inválida.");
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(data);
  const parte = (nome: Intl.DateTimeFormatPartTypes) => partes.find(p => p.type === nome)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")} ${parte("hour")}:${parte("minute")}:${parte("second")}`;
}
