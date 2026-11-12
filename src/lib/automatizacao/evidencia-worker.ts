import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import { imagemWhatsappSchema } from "@/lib/whatsapp-image";

// Somente artefatos locais do MCP; nunca URLs ou arquivos arbitrários do agente.
export async function carregarEvidenciaWorker(caminho: string, raiz: string, iniciadaEm: number) {
  const base = await realpath(raiz);
  const arquivo = await realpath(isAbsolute(caminho) ? caminho : resolve(base, caminho));
  const relativo = relative(base, arquivo);
  if (!relativo || relativo === ".." || relativo.startsWith(`..${sep}`) || isAbsolute(relativo)) throw new Error("EVIDENCIA_FORA_DA_PASTA");
  const handle = await open(arquivo, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024 || stat.mtimeMs < iniciadaEm) throw new Error("EVIDENCIA_INVALIDA");
    const bytes = await handle.readFile();
    const mimetype = bytes[0] === 137 ? "image/png" : "image/jpeg";
    imagemWhatsappSchema.parse({ media: bytes.toString("base64"), mimetype });
    // Mantém o corpo abaixo do limite da API/plataforma após base64.
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().jpeg({ quality: 80 }).toBuffer();
    if (jpeg.length > 2 * 1024 * 1024) throw new Error("EVIDENCIA_ACIMA_DO_LIMITE_DE_TRANSPORTE");
    return imagemWhatsappSchema.parse({ media: jpeg.toString("base64"), mimetype: "image/jpeg" });
  } finally { await handle.close(); }
}
