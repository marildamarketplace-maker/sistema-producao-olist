import { z } from "zod";
import type { EntidadeSync, JsonValue, CamposSync, ObservacaoRemota } from "./contrato";
import { FalhaSync, ENTIDADES_SYNC } from "./contrato";
import { referenciaVendedorContatoSync } from "./vendedores-contato";
import { referenciasTiposContatoSync } from "./tipos-contato";

export const entidadeSchema = z.enum(["PRODUTO", "CONTATO", "FORMA_PAGAMENTO", "VENDEDOR", "SERVICO"]);
export const validacaoIncrementalSchema = z.object({
  aplicativoId: z.guid(), entidade: z.enum(["PRODUTO", "CONTATO"]), validado: z.boolean(),
  fusoHorario: z.string().trim().min(1).max(100).refine(fuso => {
    try { new Intl.DateTimeFormat("pt-BR", { timeZone: fuso }); return true; } catch { return false; }
  }),
  versaoContrato: z.number().int().positive(), evidencia: z.string().trim().max(1000).optional(),
}).strict().refine(v => !v.validado || (v.evidencia?.length ?? 0) >= 20, { message: "Descreva os ensaios realizados nesta conta e entidade." });
export const configuracaoSchema = z.object({
  versao: z.number().int().positive(), ativo: z.boolean(),
  entidades: z.array(z.enum(["PRODUTO", "CONTATO", "VENDEDOR", "SERVICO"])).min(1).max(4).refine(v => new Set(v).size === v.length),
  participantesIds: z.array(z.guid()).min(2).max(20).refine(v => new Set(v).size === v.length),
  horaDiaria: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  limiteAlteracoes: z.number().int().min(1).max(100),
  prontidao: z.object({ sincronizacaoNativaCompativel: z.boolean(), semanticaPutValidada: z.boolean(), incrementalValidado: z.boolean() }).strict(),
  incrementalValidacoes: z.array(validacaoIncrementalSchema).max(40).refine(v => new Set(v.map(item => `${item.aplicativoId}:${item.entidade}`)).size === v.length).optional(),
}).strict();
export const execucaoSchema = z.object({ modo: z.enum(["AUDITAR", "AUDITAR_E_APLICAR", "APLICAR"]), idempotencia: z.uuid(), completa: z.boolean().default(true) }).strict();
export const decisaoSchema = z.object({ versao: z.number().int().positive(), acao: z.enum(["APROVAR", "REJEITAR", "IGNORAR", "REAUDITAR", "VINCULAR"]), motivo: z.string().trim().min(10).max(1000), aplicativoFonteId: z.guid().optional(),
  vinculos: z.array(z.object({aplicativoId:z.guid(),registroOlistId:z.string().regex(/^\d{1,30}$/)}).strict()).min(2).max(20).refine(v=>new Set(v.map(p=>p.aplicativoId)).size===v.length).optional(),
}).strict();
export const origemSchema = z.object({ revisao: z.number().int().positive(), aplicativoOrigemId: z.guid(), registroOlistOrigemId: z.string().regex(/^\d{1,30}$/), motivo: z.string().trim().min(10).max(1000), idempotencia: z.uuid() }).strict();
export const filtrosSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(25),
  entidade: entidadeSchema.optional(), aplicativoId: z.guid().optional(), status: z.string().max(50).optional(),
  severidade: z.enum(["CRITICA", "ALTA", "MEDIA", "INFORMATIVA"]).optional(), tipo: z.string().max(100).optional(),
  aplicativoOrigemId: z.guid().optional(), ultimaFonteAppId: z.guid().optional(),
  origemTipo: z.enum(["DESCONHECIDA", "OBSERVADA_PELO_MODULO", "DECLARADA_POR_USUARIO"]).optional(),
});
export function entidadeSync(valor: string): EntidadeSync {
  if (!(ENTIDADES_SYNC as readonly string[]).includes(valor)) throw new FalhaSync("ENTIDADE_INVALIDA", "Entidade de sincronização inválida.");
  return valor as EntidadeSync;
}
export function objetoJson(valor: unknown): CamposSync {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return {};
  return valor as CamposSync;
}
export function hashesJson(valor: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(objetoJson(valor)).filter((v): v is [string, string] => typeof v[1] === "string"));
}
export function observacaoProtegida(valor: JsonValue): ObservacaoRemota {
  const r = objetoJson(valor);
  if (typeof r.id !== "string" || typeof r.nome !== "string" || typeof r.situacao !== "string" || typeof r.completo !== "boolean" ||
    !Array.isArray(r.pendencias) || !r.pendencias.every(p => typeof p === "string") || (r.chave !== null && typeof r.chave !== "string")) {
    throw new FalhaSync("DADOS_INVALIDOS", "Observação protegida inválida.");
  }
  return { id: r.id, nome: r.nome, situacao: r.situacao, completo: r.completo, chave: r.chave,
    alteradoEm: typeof r.alteradoEm === "string" ? r.alteradoEm : null, campos: objetoJson(r.campos), pendencias: r.pendencias as string[],
    ...(typeof r.tipo === "string" ? { tipo: r.tipo } : {}), ...(typeof r.paiId === "string" ? { paiId: r.paiId } : {}),
    ...(r.vendedorContatoRemoto !== undefined ? { vendedorContatoRemoto: referenciaVendedorContatoSync(r.vendedorContatoRemoto) } : {}),
    ...(r.tiposContatoRemotos !== undefined ? { tiposContatoRemotos: referenciasTiposContatoSync(r.tiposContatoRemotos) } : {}) };
}

/** Busca no calendário local: funciona também em dias de transição de horário. */
export function proximoHorarioSync(agora: Date, hora: string, timezone = "America/Sao_Paulo"): Date {
  const formato = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const inicio = Math.floor(agora.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 26 * 60; i++) {
    const data = new Date(inicio + i * 60_000);
    if (formato.format(data) === hora) return data;
  }
  throw new FalhaSync("HORARIO_INVALIDO", "Não foi possível calcular a próxima execução.");
}
export function prazoRetrySync(tentativa: number, agora: Date, retryAfterMs = 0, aleatorio = Math.random()): Date {
  return new Date(agora.getTime() + Math.max(Math.min(30 * 60_000, retryAfterMs), Math.min(8, 2 ** Math.max(0, tentativa - 1)) * 60_000 + Math.floor(aleatorio * 15_000)));
}
