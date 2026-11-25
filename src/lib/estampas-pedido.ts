import { z } from "zod";
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
const consulta = z.object({ busca: z.string().trim().max(100), pagina: z.coerce.number().int().min(1).max(10000) });
type Linha = { codigo?: string; variante?: string | null; previewUrl?: string | null };
type Banco = { estampaCatalogoIa: { groupBy: (args: { by: Array<"codigo" | "variante">; where: Prisma.EstampaCatalogoIaWhereInput; orderBy: { codigo?: "asc"; variante?: "asc" }; take: number; skip: number }) => Promise<Linha[]>; findMany: (args: Prisma.EstampaCatalogoIaFindManyArgs) => Promise<Array<{ codigo?: string; variante?: string | null; previewUrl?: string | null }>> } };
const banco: Banco = { estampaCatalogoIa: {
  findMany: args => prisma.estampaCatalogoIa.findMany(args),
  groupBy: async args => {
    if (args.by[0] === "codigo") {
      const resultado = await prisma.estampaCatalogoIa.groupBy({ by: ["codigo"], where: args.where, orderBy: { codigo: "asc" }, take: args.take, skip: args.skip });
      return resultado;
    }
    const resultado = await prisma.estampaCatalogoIa.groupBy({ by: ["variante"], where: args.where, orderBy: { variante: "asc" }, take: args.take, skip: args.skip });
    return resultado;
  },
} };
/** Catálogo global; retorna somente códigos, em páginas limitadas. */
export async function consultarEstampasPedido(params: URLSearchParams, db: Banco = banco) {
  const { busca, pagina } = consulta.parse({ busca: params.get("busca") ?? "", pagina: params.get("pagina") ?? 1 });
  if (params.get("campo") === "preview") {
    const codigo = z.string().trim().max(500).parse(params.get("codigo") ?? "");
    const variante = z.string().trim().max(100).parse(params.get("variante") ?? "");
    if (!codigo || !variante) return { previewUrl: null };
    const imagens = await db.estampaCatalogoIa.findMany({ where: { isActive: true, codigo: { equals: codigo, mode: "insensitive" }, variante: { equals: variante, mode: "insensitive" } }, select: { previewUrl: true }, orderBy: { id: "asc" }, take: 1 });
    return { previewUrl: imagens[0]?.previewUrl ?? null };
  }
  if (params.get("campo") === "variante") {
    const codigo = z.string().trim().max(500).parse(params.get("codigo") ?? "");
    if (!codigo) return { itens: [], mais: false };
    const variantes = await db.estampaCatalogoIa.groupBy({
      by: ["variante"], where: { isActive: true, codigo: { equals: codigo, mode: "insensitive" }, variante: { not: null, ...(busca ? { startsWith: busca, mode: "insensitive" as const } : {}) } },
      orderBy: { variante: "asc" }, take: 21, skip: (pagina - 1) * 20,
    });
    return { itens: variantes.slice(0,20).flatMap(v => v.variante ? [{ codigo: v.variante }] : []), mais: variantes.length > 20 };
  }
  const itens = await db.estampaCatalogoIa.groupBy({ by: ["codigo"], where: { isActive: true, ...(busca ? { codigo: { startsWith: busca, mode: "insensitive" as const } } : {}) }, orderBy: { codigo: "asc" }, take: 21, skip: (pagina - 1) * 20 });
  return { itens: itens.slice(0,20).map(item => ({ codigo: item.codigo ?? "" })), mais: itens.length > 20 };
}
