import { z } from "zod";
import { MAX_IMAGENS_PILOTO } from "@/config/pilotoEstampas";
import { CarregarPreviewEstampaError } from "@/services/carregarPreviewEstampaService";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

export class ErroEntradaPiloto extends Error {}

export function descreverErroPiloto(error: unknown): string {
  if (error instanceof ErroEntradaPiloto) return error.message;
  if (error instanceof z.ZodError) {
    // Apenas caminhos e códigos: mensagens podem conter valores fornecidos.
    return `Estrutura da amostra inválida. Campos: ${error.issues.map(issue => `${issue.path.join(".") || "raiz"} (${issue.code})`).join(", ")}. Esperado: lista de 1 a ${MAX_IMAGENS_PILOTO} itens com id textual e preview_url.`;
  }
  if (error instanceof CarregarPreviewEstampaError) return `Falha no preview (${error.code}). Confira a URL, a disponibilidade da imagem e ESTAMPA_PREVIEW_ALLOWED_HOSTS. URL omitida.`;
  if (error instanceof ImageAnalysisProviderError) return `Falha no provider (${error.code}). Confira configuração e registros salvos. Dados sensíveis omitidos.`;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "ENOENT") return "Arquivo de amostra não encontrado. Crie o JSON ou informe o caminho correto; consulte amostra.exemplo.json.";
  if (code === "EACCES" || code === "EPERM") return "Sem permissão para ler a amostra ou gravar o relatório.";
  if (error instanceof SyntaxError) return "JSON da amostra inválido. Confira vírgulas, aspas duplas e colchetes.";
  return "Falha inesperada no piloto. Confira a configuração e registros salvos; detalhes sensíveis foram omitidos.";
}
