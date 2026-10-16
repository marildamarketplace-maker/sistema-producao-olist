import { EvidenciaProducaoError, MAX_CORPO_CONFIRMACAO_BYTES, MAX_FOTO_EVIDENCIA_BYTES } from "./producao-evidencia-contrato";

export async function lerFormularioConfirmacao(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_CORPO_CONFIRMACAO_BYTES) {
    throw new EvidenciaProducaoError("Dados enviados excedem o limite permitido.", 413);
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    throw new EvidenciaProducaoError("Envie a foto do pedido em papel para confirmar a produção.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new EvidenciaProducaoError("Envie a foto do pedido em papel.");
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > MAX_CORPO_CONFIRMACAO_BYTES) {
        await reader.cancel();
        throw new EvidenciaProducaoError("Dados enviados excedem o limite permitido.", 413);
      }
      partes.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(partes), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new EvidenciaProducaoError("Formulário de confirmação inválido.");
  }
  const foto = form.get("foto");
  if (!(foto instanceof File) || foto.size === 0) {
    throw new EvidenciaProducaoError("Envie a foto do pedido em papel para confirmar a produção.");
  }
  if (foto.size > MAX_FOTO_EVIDENCIA_BYTES) {
    throw new EvidenciaProducaoError("A foto deve ter no máximo 3 MB.", 413);
  }
  let itens: unknown;
  try { itens = JSON.parse(String(form.get("itens") ?? "")); } catch {
    throw new EvidenciaProducaoError("Informe os itens da solicitação.");
  }
  return { foto, itens, senha: form.get("senha"), solicitacaoId: String(form.get("solicitacaoId") ?? "").trim() };
}
