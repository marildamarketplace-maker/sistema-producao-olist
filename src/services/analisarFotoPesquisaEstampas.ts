import { AI_ANALYSIS_PROMPT_VERSION } from "@/config/ai";
import { normalizarDesignPesquisa, normalizarFiltroDesign } from "@/domain/pesquisa-estampas-design";
import type { ReferenciaFotoEstampa } from "@/domain/referencia-foto-estampa";
import { analiseVisualEstampaStructuredOutput, type AnaliseVisualEstampa } from "@/schemas/analiseVisualEstampaSchema";
import { analisarImagemEstampaComFallback, PROMPT_ANALISE_VISUAL_ESTAMPA } from "./analisarVisualEstampaService";
import { criarImageAnalysisProvider } from "./image-analysis/imageAnalysisProviderFactory";
import { normalizarTaxonomiasAnalise } from "./normalizarTaxonomiaEstampa";
import { ErroBuscaVisual } from "@/lib/estampas-visuais/imagem";

export function referenciaFotoDaAnalise(valor: AnaliseVisualEstampa): ReferenciaFotoEstampa {
  const analise = normalizarTaxonomiasAnalise(valor);
  const design = normalizarDesignPesquisa(analise);
  return {
    motivos: [...new Set(analise.elementosVisuais)].slice(0, 5),
    cores: [...new Set(analise.coresPrincipais)].slice(0, 4),
    tema: analise.tema,
    estilo: normalizarFiltroDesign("estilo", analise.estilo),
    distribuicao: design.distribuicoes[0] ?? "",
    linguagemVisual: design.linguagensVisuais[0] ?? "",
  };
}
export async function analisarFotoPesquisaEstampas(bytes: Buffer): Promise<ReferenciaFotoEstampa> {
  try {
    const resultado = await analisarImagemEstampaComFallback({
      image: { buffer: bytes, mimeType: "image/jpeg", sizeBytes: bytes.length },
      prompt: PROMPT_ANALISE_VISUAL_ESTAMPA,
      promptVersion: AI_ANALYSIS_PROMPT_VERSION,
      output: analiseVisualEstampaStructuredOutput,
    }, criarImageAnalysisProvider("primary"), criarImageAnalysisProvider("fallback"));
    const referencia = referenciaFotoDaAnalise(resultado.data);
    if (!referencia.motivos.length && !referencia.cores.length && !referencia.tema && !referencia.estilo && !referencia.distribuicao && !referencia.linguagemVisual) {
      throw new ErroBuscaVisual("Não foi possível identificar características suficientes. Tente outra foto.", 422);
    }
    return referencia;
  } catch (erro) {
    if (erro instanceof ErroBuscaVisual) throw erro;
    throw new ErroBuscaVisual("Não foi possível analisar a foto. Tente novamente ou use uma imagem mais nítida.", 503);
  }
}
