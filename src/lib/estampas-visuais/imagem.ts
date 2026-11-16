import sharp from "sharp";
import { createHash } from "node:crypto";

export const MAX_IMAGEM_BYTES = 10 * 1024 * 1024;
export class ErroBuscaVisual extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function normalizarImagemVisual(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGEM_BYTES) throw new ErroBuscaVisual("Envie uma imagem de até 10 MB.");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) throw new ErroBuscaVisual("Formato inválido. Use JPEG, PNG ou WebP.");
  try {
    const imagem = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
    const meta = await imagem.metadata();
    if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16 || (meta.pages ?? 1) !== 1) {
      throw new Error("Dimensões inválidas");
    }
    // Auto-orientação e remoção de metadados; nunca cortar a composição.
    const normalizada = await imagem.rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    return { bytes: normalizada, hash: createHash("sha256").update(normalizada).digest("hex") };
  } catch { throw new ErroBuscaVisual("Imagem inválida. Use uma foto estática de até 40 megapixels."); }
}
