import { z } from "zod";
const idOlist = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const produtoFilaOlistSchema = z.object({ id: idOlist, preco: z.number().min(0).max(1e9) }).strict();
export const selecoesFilaOlistSchema = z.object({
  clienteId: idOlist, vendedorId: idOlist, formaId: idOlist, planoId: z.guid(),
  tipoVenda: z.enum(["VENDA", "VENDA_G", "VENDA_PC"]),
  tecidos: z.array(z.object({ tecidoId: z.guid(), ...produtoFilaOlistSchema.shape }).strict()).min(1).max(500),
  laser: produtoFilaOlistSchema.nullable(),
}).strict();
export type SelecoesFilaOlist = z.infer<typeof selecoesFilaOlistSchema>;
export type OpcaoFilaOlist = { id: number; nome: string; referencia?: string; preco?: number };
export type EstadoEnvioFila = { estado: string; aplicativoNome?: string; pedidoOlistId: string | null; diagnostico: string | null; iniciadoEm: string; aplicativoId: string; tentativaId: string };
