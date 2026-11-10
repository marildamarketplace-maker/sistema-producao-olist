export async function lerCorpoLimitado(request: Request, limiteBytes: number) {
  if (Number(request.headers.get("content-length")) > limiteBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let texto = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return texto + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limiteBytes) {
        await reader.cancel();
        return null;
      }
      texto += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
