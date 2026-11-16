import { ErroBuscaVisual, MAX_IMAGEM_BYTES } from "./imagem";

export async function lerUploadVisual(request: Request): Promise<FormData> {
  const limite = MAX_IMAGEM_BYTES + 64 * 1024;
  const tamanho = Number(request.headers.get("content-length"));
  if (tamanho > limite) throw new ErroBuscaVisual("Envie uma imagem de até 10 MB.", 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new ErroBuscaVisual("Envio inválido.");
  const reader = request.body?.getReader();
  if (!reader) throw new ErroBuscaVisual("Envie uma foto.");
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limite) { await reader.cancel(); throw new ErroBuscaVisual("Envie uma imagem de até 10 MB.", 413); }
      partes.push(value);
    }
    const bytes = Buffer.concat(partes);
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch (erro) {
    if (erro instanceof ErroBuscaVisual) throw erro;
    throw new ErroBuscaVisual("Não foi possível ler a imagem enviada.");
  } finally { reader.releaseLock(); }
}
