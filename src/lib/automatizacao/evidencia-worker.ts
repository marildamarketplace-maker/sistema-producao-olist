import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import { imagemWhatsappSchema } from "@/lib/whatsapp-image";

export function motivoEvidenciaIndisponivel(error: unknown) {
  const codigo = error instanceof Error ? error.message : "";
  const sistema = (error as NodeJS.ErrnoException | null)?.code;
  if (sistema === "ENOENT") return "arquivo ou pasta de evidências não encontrado";
  if (sistema === "EACCES" || sistema === "EPERM") return "worker sem permissão de leitura da captura";
  if (codigo === "EVIDENCIA_FORA_DA_PASTA") return "captura fora da pasta de evidências configurada";
  if (codigo === "EVIDENCIA_ANTIGA") return "captura anterior ao início desta execução";
  if (codigo === "EVIDENCIA_TAMANHO") return "captura acima de 5 MiB";
  if (codigo === "EVIDENCIA_ACIMA_DO_LIMITE_DE_TRANSPORTE") return "imagem acima do limite de transporte após conversão";
  return "arquivo não é uma imagem JPEG/PNG válida ou não pôde ser convertido";
}

// Somente artefatos locais do MCP; nunca URLs ou arquivos arbitrários do agente.
export async function carregarEvidenciaWorker(caminho: string, raiz: string, iniciadaEm: number) {
  const base = await realpath(raiz);
  const dentroDaPasta = (arquivo: string) => {
    const relativo = relative(base, arquivo);
    return Boolean(relativo) && relativo !== ".." && !relativo.startsWith(`..${sep}`) && !isAbsolute(relativo);
  };
  // O MCP pode exibir o caminho relativo ao output-dir, ao seu cwd (pai do
  // perfil) ou ao workspace do cliente. A raiz permitida permanece a mesma.
  const candidatos = isAbsolute(caminho) ? [caminho]
    : [resolve(base, caminho), resolve(dirname(base), caminho), resolve(process.cwd(), caminho)];
  let arquivo: string | undefined;
  let erro: unknown = new Error("EVIDENCIA_FORA_DA_PASTA");
  for (const candidato of new Set(candidatos)) {
    if (!isAbsolute(caminho) && !dentroDaPasta(candidato)) continue;
    try {
      const real = await realpath(candidato);
      if (!dentroDaPasta(real)) throw new Error("EVIDENCIA_FORA_DA_PASTA");
      arquivo = real;
      break;
    } catch (error) { erro = error; }
  }
  if (!arquivo) throw erro;
  const handle = await open(arquivo, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("EVIDENCIA_INVALIDA");
    if (stat.size > 5 * 1024 * 1024) throw new Error("EVIDENCIA_TAMANHO");
    if (stat.mtimeMs < iniciadaEm) throw new Error("EVIDENCIA_ANTIGA");
    const bytes = await handle.readFile();
    const mimetype = bytes[0] === 137 ? "image/png" : "image/jpeg";
    imagemWhatsappSchema.parse({ media: bytes.toString("base64"), mimetype });
    // Mantém o corpo abaixo do limite da API/plataforma após base64.
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().jpeg({ quality: 80 }).toBuffer();
    if (jpeg.length > 2 * 1024 * 1024) throw new Error("EVIDENCIA_ACIMA_DO_LIMITE_DE_TRANSPORTE");
    return imagemWhatsappSchema.parse({ media: jpeg.toString("base64"), mimetype: "image/jpeg" });
  } finally { await handle.close(); }
}
