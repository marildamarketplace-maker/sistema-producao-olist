import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizarImagemVisual } from "@/lib/estampas-visuais/imagem";
import { getDefaultStorage, deleteStoredMedia } from "./defaultStorageService";
import { validarUrlPreviewEstampa } from "./carregarPreviewEstampaService";

export const cadastroEstampaSchema = z.object({
  codigo: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f/\\]+$/),
  variante: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f/\\]+$/),
});
export class EstampaDuplicadaError extends Error {
  constructor(public existente: { id: string; codigo: string; variante: string | null; previewUrl: string | null }) {
    super("Código e variante já cadastrados.");
  }
}
const select = { id: true, codigo: true, variante: true, previewUrl: true } as const;
type DependenciasCadastro = { db: typeof prisma; storage: ReturnType<typeof getDefaultStorage>; remover: typeof deleteStoredMedia };
export async function cadastrarEstampaManual(input: { codigo: string; variante: string; bytes: Buffer; usuarioId: string }, dependencias?: DependenciasCadastro) {
  const db = dependencias?.db ?? prisma;
  const campos = cadastroEstampaSchema.parse(input);
  const where = { codigo: { equals: campos.codigo, mode: "insensitive" as const }, variante: { equals: campos.variante, mode: "insensitive" as const } };
  const existente = await db.estampaCatalogoIa.findFirst({ where, select });
  if (existente) throw new EstampaDuplicadaError({ ...existente, id: String(existente.id) });
  const imagem = await normalizarImagemVisual(input.bytes);
  const storage = dependencias?.storage ?? getDefaultStorage();
  const path = `estampas/manual/${randomUUID()}.jpg`;
  const objeto = await storage.upload({ path, buffer: imagem.bytes, contentType: "image/jpeg", somenteNovo: true, signal: AbortSignal.timeout(20_000) });
  try {
    validarUrlPreviewEstampa(objeto.publicUrl);
    const cadastrar = () => db.$transaction(async tx => {
      // Serializa cadastros manuais da mesma identidade, inclusive duplo clique.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([campos.codigo.toLowerCase(), campos.variante.toLowerCase()])}, 0))::text`;
      const duplicada = await tx.estampaCatalogoIa.findFirst({ where, select });
      if (duplicada) throw new EstampaDuplicadaError({ ...duplicada, id: String(duplicada.id) });
      const agora = new Date();
      const estampa = await tx.estampaCatalogoIa.create({ data: {
        ...campos, previewUrl: objeto.publicUrl, storageKey: objeto.path,
        originalFilename: `${campos.codigo}-${campos.variante}.jpg`, originalExtension: ".jpg",
        contentHash: imagem.hash, processingStatus: "PENDING", createdAt: agora, updatedAt: agora,
      }, select: { id: true } });
      const job = await tx.estampaJob.create({ data: { estampaId: estampa.id, tipo: "AI_ANALYSIS", manualRequested: true, manualRequestedAt: agora, manualRequestedBy: input.usuarioId }, select: { id: true } });
      return { estampaId: String(estampa.id), jobId: job.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    // Repetir somente transações explicitamente abortadas por conflito; upload é reutilizado.
    for (let tentativa = 0; ; tentativa++) {
      try { return await cadastrar(); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || tentativa >= 2) throw error;
      }
    }
  } catch (error) {
    // Não remover um objeto se o commit tiver ocorrido mas sua confirmação se perdido.
    const vinculado = await db.estampaCatalogoIa.findFirst({ where: { storageKey: objeto.path }, select: { id: true } });
    if (!vinculado) await (dependencias?.remover ?? deleteStoredMedia)(objeto.path, objeto.publicUrl);
    throw error;
  }
}
