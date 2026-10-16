import { MAX_DIMENSAO_FOTO_EVIDENCIA, MAX_FOTO_EVIDENCIA_BYTES } from "./producao-evidencia-contrato";

export async function prepararFotoProducao(arquivo: File): Promise<File> {
  if (!arquivo.type.startsWith("image/") || !arquivo.size || arquivo.size > 20 * 1024 * 1024) {
    throw new Error("Selecione uma foto de até 20 MB.");
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = new Image();
    imagem.src = url;
    try { await imagem.decode(); } catch {
      throw new Error("Não foi possível abrir esta foto. Tire uma nova foto ou selecione uma imagem JPG, PNG ou WebP.");
    }
    const escala = Math.min(1, MAX_DIMENSAO_FOTO_EVIDENCIA / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Não foi possível preparar a foto neste navegador.");
    contexto.fillStyle = "white";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    for (const qualidade of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", qualidade));
      if (blob && blob.size <= MAX_FOTO_EVIDENCIA_BYTES) {
        return new File([blob], "evidencia-pedido.jpg", { type: "image/jpeg" });
      }
    }
    throw new Error("A foto ficou muito grande. Selecione uma foto menor ou tire outra mais próxima do papel.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
