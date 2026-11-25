import { z } from "zod";
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
const consulta = z.object({ busca: z.string().trim().max(100), pagina: z.coerce.number().int().min(1).max(10000) });
type Banco = { estampaCatalogoIa: { findMany: (args: Prisma.EstampaCatalogoIaFindManyArgs) => Promise<Array<{ codigo?: string; variante?: string | null; previewUrl?: string | null }>> } };
/** Catálogo global; retorna somente códigos, em páginas limitadas. */
export async function consultarEstampasPedido(params: URLSearchParams, db: Banco = prisma) {
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
    const variantes = await db.estampaCatalogoIa.findMany({
      where: { isActive: true, codigo: { equals: codigo, mode: "insensitive" }, variante: { not: null, ...(busca ? { startsWith: busca, mode: "insensitive" as const } : {}) } },
      select: { variante: true }, orderBy: [{ variante: "asc" }, { id: "asc" }], take: 21, skip: (pagina - 1) * 20,
    });
    return { itens: variantes.slice(0,20).flatMap(v => v.variante ? [{ codigo: v.variante }] : []), mais: variantes.length > 20 };
  }
  const itens = await db.estampaCatalogoIa.findMany({ where: { isActive: true, ...(busca ? { codigo: { startsWith: busca, mode: "insensitive" as const } } : {}) }, select: { codigo: true }, orderBy: [{ codigo: "asc" }, { id: "asc" }], take: 21, skip: (pagina - 1) * 20 });
  return { itens: itens.slice(0,20).map(item => ({ codigo: item.codigo ?? "" })), mais: itens.length > 20 };
}
