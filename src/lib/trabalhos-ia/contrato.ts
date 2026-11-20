import { z } from "zod";

export const PROTOCOLO_IA = 1;
export const TIPO_RELATORIO_SKU = "anotar_sku.relatorio.v1";
export const ESTADOS_ATIVOS_IA = ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"] as const;
export const textoIa = (max: number) => z.string().max(max).trim().refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "Texto contém caracteres inválidos.");
export const solicitarIaSchema = z.object({ chave: z.uuid() }).strict();
export const configurarIaSchema = z.object({ prompt: textoIa(8_000), revisao: z.number().int().nonnegative() }).strict();
export const acaoIaSchema = z.object({ acao: z.enum(["cancelar", "retomar"]) }).strict();
export const operacaoIaSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("reservar"), protocolo: z.literal(PROTOCOLO_IA), tipos: z.array(textoIa(100).min(1)).min(1).max(20) }).strict(),
  z.object({ acao: z.literal("renovar"), reserva: z.uuid() }).strict(),
  z.object({ acao: z.literal("finalizar"), reserva: z.uuid(), resultado: z.unknown() }).strict(),
  z.object({ acao: z.literal("falhar"), reserva: z.uuid(), codigo: z.enum(["TEMPORARIA", "RESPOSTA_INVALIDA", "AUTENTICACAO", "CONFIGURACAO", "TEMPO_LIMITE"]) }).strict(),
]);
export type OperacaoIa = z.infer<typeof operacaoIaSchema>;
export type EscopoIa = { id: string; aplicativoId: string };
export type WorkerIa = EscopoIa & { tipos: string[]; grupo: string };
export type FaseIa = "PREPARAR" | "GERAR" | "REVISAR" | "PUBLICAR";
export type TrabalhoIaResumo = {
  id: string; tipo: string; origemId: string; status: string; fase: FaseIa;
  total: number; processados: number; erro: string | null; criadoEm: string;
  finalizadoEm: string | null; revisaoConfig: number;
};
export const respostaReservaIaSchema = z.object({ trabalho: z.object({
  reserva: z.uuid(), tipo: textoIa(100), fase: z.enum(["GERAR", "REVISAR"]),
  prompt: textoIa(200_000), schema: z.record(z.string(), z.unknown()), timeoutMs: z.number().int().min(1).max(300_000),
}).nullable(), aguardarMs: z.number().int().min(0).max(60_000) });
export type TrabalhoWorkerIa = NonNullable<z.infer<typeof respostaReservaIaSchema>["trabalho"]>;
export class ErroTrabalhoIa extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
