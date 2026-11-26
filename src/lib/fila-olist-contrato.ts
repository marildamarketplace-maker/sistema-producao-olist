import { z } from "zod";
const idOlist = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const produtoFilaOlistSchema = z.object({ id: idOlist, preco: z.number().min(0).max(1e9) }).strict();
export const selecoesFilaOlistSchema = z.object({
  recursoForma: z.literal("RECEBIMENTO"),
  clienteId: idOlist, vendedorId: idOlist, formaId: idOlist, planoId: z.guid(),
  tipoVenda: z.enum(["VENDA", "VENDA_G", "VENDA_PC"]),
  tecidos: z.array(z.object({ tecidoId: z.guid(), ...produtoFilaOlistSchema.shape }).strict()).min(1).max(1000),
  laser: produtoFilaOlistSchema.nullable(),
}).strict();
export type SelecoesFilaOlist = z.infer<typeof selecoesFilaOlistSchema>;
export type OpcaoFilaOlist = { id: number; nome: string; referencia?: string; preco?: number };
export type EstadoEnvioFila = { estado: string; aplicativoNome?: string; pedidoOlistId: string | null; diagnostico: string | null; iniciadoEm: string; aplicativoId: string; tentativaId: string };

const produtoParcialSchema = produtoFilaOlistSchema.extend({ preco: produtoFilaOlistSchema.shape.preco.optional() });
export const selecoesFilaOlistParciaisSchema = selecoesFilaOlistSchema.partial().extend({
  tecidos: z.array(produtoParcialSchema.extend({ tecidoId: z.guid() }).strict()).max(1000).optional(),
  laser: produtoParcialSchema.nullable().optional(),
}).strict().refine((s) => !s.planoId || !!s.formaId, { message: "Selecione a forma antes do plano de recebimento." });
export const dadosOlistFilaSchema = z.object({ filialId: z.guid(), selecoes: selecoesFilaOlistParciaisSchema,
  vendedorFonte: z.enum(["VINCULO", "MANUAL"]).optional(), vendedorRevisao: z.number().int().positive().optional(),
}).strict();
export type SelecoesFilaOlistParciais = z.infer<typeof selecoesFilaOlistParciaisSchema>;
/** Respostas por campo transportam somente seleções alteradas, inclusive tecidos equivalentes. */
export function mesclarSelecoesRecuperadas(atuais: SelecoesFilaOlistParciais, alteracoes: SelecoesFilaOlistParciais): SelecoesFilaOlistParciais {
  return { ...atuais, ...alteracoes,
    ...(alteracoes.formaId !== undefined && alteracoes.formaId !== atuais.formaId ? { planoId: alteracoes.planoId } : {}),
    tecidos: [...(atuais.tecidos ?? []).filter(t => !alteracoes.tecidos?.some(n => n.tecidoId === t.tecidoId)), ...(alteracoes.tecidos ?? [])],
  };
}
export type RascunhoFilaOlist = Omit<SelecoesFilaOlist, "tipoVenda" | "tecidos" | "laser"> & {
  tipoVenda: SelecoesFilaOlist["tipoVenda"] | "";
  tecidos: Array<{ tecidoId: string; id: number; preco: number | null }>;
  laser: { id: number; preco: number | null } | null;
};
export function criarRascunhoFilaOlist(tecidos: string[], salvas?: SelecoesFilaOlistParciais, vendedorPadraoId?: number | null): RascunhoFilaOlist {
  return { recursoForma: "RECEBIMENTO", clienteId: salvas?.clienteId ?? 0, vendedorId: salvas?.vendedorId ?? vendedorPadraoId ?? 0, formaId: salvas?.recursoForma === "RECEBIMENTO" ? salvas.formaId ?? 0 : 0,
    planoId: salvas?.recursoForma === "RECEBIMENTO" ? salvas.planoId ?? "" : "", tipoVenda: salvas?.tipoVenda ?? "", laser: salvas?.laser ? { id: salvas.laser.id, preco: salvas.laser.preco ?? null } : null,
    tecidos: [...new Set(tecidos)].map((tecidoId) => { const salvo = salvas?.tecidos?.find((s) => s.tecidoId === tecidoId); return { tecidoId, id: salvo?.id ?? 0, preco: salvo?.preco ?? null }; }) };
}
export function serializarRascunhoFilaOlist(rascunho: RascunhoFilaOlist): SelecoesFilaOlistParciais {
  const resultado = selecoesFilaOlistParciaisSchema.safeParse({ recursoForma: "RECEBIMENTO", clienteId: rascunho.clienteId || undefined, vendedorId: rascunho.vendedorId || undefined,
    formaId: rascunho.formaId || undefined, planoId: rascunho.planoId || undefined, tipoVenda: rascunho.tipoVenda || undefined,
    tecidos: rascunho.tecidos.filter((t) => t.id > 0).map((t) => ({ ...t, preco: t.preco ?? undefined })),
    laser: rascunho.laser?.id ? { ...rascunho.laser, preco: rascunho.laser.preco ?? undefined } : null });
  if (!resultado.success) throw new Error("Revise os dados comerciais: IDs e preços devem ser válidos, e o plano precisa de uma forma de recebimento.");
  return resultado.data;
}
