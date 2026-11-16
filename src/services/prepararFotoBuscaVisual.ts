// Reduz o envio para caber também no limite de corpo das Functions, preservando a imagem inteira.
export async function prepararFotoBuscaVisual(foto: File): Promise<Blob> {
  const bitmap = await createImageBitmap(foto);
  try {
    if (bitmap.width * bitmap.height > 40_000_000 || bitmap.width < 16 || bitmap.height < 16) {
      throw new Error("Use uma foto de até 40 megapixels, com pelo menos 16 pixels em cada dimensão.");
    }
    const fator = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * fator));
    canvas.height = Math.max(1, Math.round(bitmap.height * fator));
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Não foi possível preparar a foto neste navegador.");
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a foto.")), "image/jpeg", 0.9,
    ));
  } finally { bitmap.close(); }
}
