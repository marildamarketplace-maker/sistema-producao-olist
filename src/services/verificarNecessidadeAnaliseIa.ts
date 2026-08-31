import type { EstampaCatalogo } from "@/repositories/catalogo-estampas-repository";
import {
  analiseCorrespondeAoConteudoAtual,
  normalizarHashConteudo,
} from "@/services/controleVersaoAnaliseEstampa";

export type ResultadoVerificacaoAnaliseIa =
  | { acao: "PROCESSAR"; contentHash: string }
  | { acao: "IGNORAR_JA_PROCESSADA"; contentHash: string };

export class EstampaInvalidaParaAnaliseError extends Error {
  readonly retriable = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EstampaInvalidaParaAnaliseError";
  }
}

export function verificarNecessidadeAnaliseIa(
  estampa: EstampaCatalogo,
  options: { reprocessamentoManual?: boolean } = {},
): ResultadoVerificacaoAnaliseIa {
  const previewUrl = estampa.preview_url?.trim();
  if (!previewUrl) {
    throw new EstampaInvalidaParaAnaliseError("A estampa não possui preview_url.");
  }

  try {
    const url = new URL(previewUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error("URL não permitida");
    }
  } catch (error) {
    throw new EstampaInvalidaParaAnaliseError("A estampa possui preview_url inválida.", {
      cause: error,
    });
  }

  const contentHash = normalizarHashConteudo(estampa.content_hash);
  if (!contentHash) {
    throw new EstampaInvalidaParaAnaliseError("A estampa não possui content_hash válido.");
  }

  if (!options.reprocessamentoManual && analiseCorrespondeAoConteudoAtual(estampa)) {
    return { acao: "IGNORAR_JA_PROCESSADA", contentHash };
  }

  return { acao: "PROCESSAR", contentHash };
}
