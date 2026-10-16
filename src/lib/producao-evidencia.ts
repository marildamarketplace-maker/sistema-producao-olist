import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { confirmarEntregaProducao, type ItemConfirmacaoProducao } from "./confirmar-producao";
import { EvidenciaProducaoError, MAX_DIMENSAO_FOTO_EVIDENCIA, MAX_FOTO_EVIDENCIA_BYTES } from "./producao-evidencia-contrato";
import { deleteGoogleStorageObject, uploadToGoogleStorage, verificarGoogleStorageBucketPrivado } from "../services/googleStorageService";

export async function normalizarFotoEvidencia(foto: File): Promise<Buffer> {
  if (!foto.size || foto.size > MAX_FOTO_EVIDENCIA_BYTES) {
    throw new EvidenciaProducaoError("Envie uma foto de até 3 MB.");
  }
  try {
    const imagem = sharp(Buffer.from(await foto.arrayBuffer()), { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await imagem.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "heif"].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
      throw new Error("Formato não permitido");
    }
    // Decodifica a imagem, aplica orientação e remove EXIF/GPS e demais metadados.
    return await imagem.rotate().resize({
      width: MAX_DIMENSAO_FOTO_EVIDENCIA,
      height: MAX_DIMENSAO_FOTO_EVIDENCIA,
      fit: "inside",
      withoutEnlargement: true,
    }).jpeg({ quality: 75 }).toBuffer();
  } catch {
    throw new EvidenciaProducaoError("Foto inválida ou formato não suportado. Envie uma imagem JPG, PNG ou WebP.");
  }
}

const storagePadrao = {
  verificarPrivacidade: verificarGoogleStorageBucketPrivado,
  enviar: uploadToGoogleStorage,
  remover: deleteGoogleStorageObject,
};

export async function confirmarProducaoComEvidencia(input: {
  aplicativoId: string;
  solicitacaoId: string;
  itens: ItemConfirmacaoProducao[];
  foto: File;
}, storage: typeof storagePadrao = storagePadrao) {
  const { prisma } = await import("./prisma");
  const solicitacao = await prisma.solicitacaoProducao.findFirst({
    where: { id: input.solicitacaoId, aplicativoId: input.aplicativoId, status: "em_producao" },
    select: { id: true },
  });
  if (!solicitacao) throw new EvidenciaProducaoError("Solicitação não encontrada ou já confirmada.");
  const buffer = await normalizarFotoEvidencia(input.foto);
  const bucket = process.env.GOOGLE_CLOUD_STORAGE_EVIDENCIAS_BUCKET?.trim();
  if (!bucket) throw new EvidenciaProducaoError("Armazenamento de evidências não configurado.", 503);
  await storage.verificarPrivacidade(bucket);
  const arquivo = await storage.enviar({
    bucket, path: `producao-evidencias/${input.aplicativoId}/${input.solicitacaoId}/${randomUUID()}.jpg`,
    buffer, contentType: "image/jpeg",
  });
  try {
    await confirmarEntregaProducao({ ...input, evidencia: { url: arquivo.publicUrl, bucket: arquivo.bucket, path: arquivo.path } });
  } catch (error) {
    // Se houve commit seguido de falha de rede, não apagar a evidência já vinculada.
    try {
      const persistida = await prisma.solicitacaoProducao.findFirst({
        where: { id: input.solicitacaoId, aplicativoId: input.aplicativoId, evidenciaUrl: arquivo.publicUrl },
        select: { id: true },
      });
      if (!persistida) await storage.remover(arquivo.path, arquivo.bucket);
    } catch {
      console.error("[producao-evidencia] Não foi possível reconciliar o arquivo após falha na confirmação.");
    }
    throw error;
  }
}
