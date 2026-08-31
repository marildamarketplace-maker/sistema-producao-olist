import type { EstampaCatalogo } from "@/repositories/catalogo-estampas-repository";
import {
  AI_ANALYSIS_PROMPT_VERSION,
  AI_FALLBACK_IMAGE_DETAIL,
  AI_FALLBACK_MODEL,
  AI_MIN_CONFIDENCE,
  AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS,
  AI_PRIMARY_IMAGE_DETAIL,
  AI_PRIMARY_MODEL,
} from "@/config/ai";
import {
  analiseVisualEstampaStructuredOutput,
  type AnaliseVisualEstampa,
} from "@/schemas/analiseVisualEstampaSchema";
import { carregarPreviewEstampa } from "@/services/carregarPreviewEstampaService";
import type {
  ImageAnalysisInput,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from "@/services/image-analysis/ImageAnalysisProvider";
import { criarImageAnalysisProvider } from "@/services/image-analysis/imageAnalysisProviderFactory";
import { ImageAnalysisProviderError } from "@/services/image-analysis/OpenAIImageAnalysisProvider";

const PROMPT_VISUAL_BASE = `Analise somente o conteúdo visual em português do Brasil. Use evidência observável; não invente contexto. Não infira material, tecido, metragem, tamanho, preço, marketplace ou produto não visível. Sem linguagem comercial.

Descrição: 1 a 3 frases objetivas sobre elementos, tema, composição, cores e estilo. Tema, subtemas, categorias e ocasiões devem ser distintos; ocasião só com sinal visual claro. Elementos devem ser concretos e específicos. Palavras-chave devem ser curtas, relevantes e sem sinônimos artificiais. Cores devem usar nomes humanos, agrupando microvariações.`;

const PROMPT_PALAVRAS_CHAVE = `Gere poucas palavrasChave visuais. Não gere variações para SEO: sinônimos e combinações serão acrescentados pela aplicação.`;

const PROMPT_CORES = `Separe cores dominantes em coresPrincipais e acentos relevantes em coresSecundarias, sem repetir.`;

const PROMPT_ELEMENTOS_VISUAIS = `Em elementosVisuais, use nomes pesquisáveis de objetos, símbolos e personagens realmente visíveis; evite termos vagos ou redundantes.`;

const PROMPT_CLASSIFICACAO_CONTEXTUAL = `Use classificação contextual específica somente com evidência. Na dúvida, prefira Floral, Geométrico, Abstrato ou outro motivo literal. Floral genérico não implica Dia das Mães.`;

export const PROMPT_SEGMENTACAO_BUSCA = `segmentacaoBusca é opcional e usa apenas os termos controlados do schema. As listas podem ficar vazias. Não associe cor, flor ou estilo isolado a gênero; não infira idade, etnia, religião, saúde ou identidade. Contextos e públicos exigem evidência visual; evidencias podem ficar vazias para economizar saída.`;

export const PROMPT_CLASSIFICACAO_TEXTIL = `Classifique o padrão visual com o vocabulário têxtil do schema, sem afirmar material. Use poá para repetição dominante de círculos ou bolinhas; vichy apenas no xadrez regular característico; paisley para gotas/caxemira; animal print para marcas reconhecíveis de animal. Use geométrico somente quando formas dominarem. Sinônimos serão adicionados pela aplicação.`;

export const PROMPT_APRESENTACAO_IMAGEM = `Determine a apresentação antes da arte:
1. Dobras, volume, perspectiva, costura, caimento, sombra, fixadores, pessoa, manequim, produto ou ambiente indicam objeto físico e aplicação; nesse caso nunca use ESTAMPA.
2. ESTAMPA exige arte digital plana sem objeto ou cenário.
3. LAYOUT reúne painéis, variantes, códigos, texto ou arte + aplicação.
4. APLICACAO_PRODUTO mostra a arte em pessoa/modelo real, manequim, produto isolado ou ambiente. Mockup realista conta.

Registre conteúdos presentes e suporte. Aplicação presente exige descrição e 1 a 3 evidências físicas; ausente exige suporte NAO_APLICAVEL, descrição nula e evidências vazias. Bandeira fotografada pendurada em uma parede com dobras, sombra ou fixadores é APLICACAO_PRODUTO, não ESTAMPA plana. Não identifique nem atribua características pessoais.`;

export const PROMPT_ANALISE_VISUAL_ESTAMPA = `${PROMPT_VISUAL_BASE}\n\n${PROMPT_APRESENTACAO_IMAGEM}\n\n${PROMPT_ELEMENTOS_VISUAIS}\n\n${PROMPT_CLASSIFICACAO_CONTEXTUAL}\n\n${PROMPT_CLASSIFICACAO_TEXTIL}\n\n${PROMPT_SEGMENTACAO_BUSCA}\n\n${PROMPT_PALAVRAS_CHAVE}\n\n${PROMPT_CORES}`;

export async function analisarVisualEstampa(
  estampa: EstampaCatalogo,
  primaryProvider: ImageAnalysisProvider = criarImageAnalysisProvider(
    AI_PRIMARY_MODEL,
    AI_PRIMARY_IMAGE_DETAIL,
  ),
  fallbackProvider: ImageAnalysisProvider = criarImageAnalysisProvider(
    AI_FALLBACK_MODEL,
    AI_FALLBACK_IMAGE_DETAIL,
  ),
): Promise<ImageAnalysisResult<AnaliseVisualEstampa>> {
  const carregamentoIniciadoEm = Date.now();
  console.info("[estampas-ai] Carregando preview da estampa.", {
    estampaId: estampa.id,
  });
  const preview = await carregarPreviewEstampa(estampa);
  console.info("[estampas-ai] Preview carregado; acionando modelo primário.", {
    estampaId: estampa.id,
    mimeType: preview.mimeType,
    sizeBytes: preview.sizeBytes,
    carregamentoMs: Date.now() - carregamentoIniciadoEm,
    model: primaryProvider.model,
  });
  return analisarImagemEstampaComFallback({
    image: preview,
    prompt: PROMPT_ANALISE_VISUAL_ESTAMPA,
    promptVersion: AI_ANALYSIS_PROMPT_VERSION,
    output: analiseVisualEstampaStructuredOutput,
  }, primaryProvider, fallbackProvider);
}

export class AnaliseVisualQualidadeInsuficienteError extends Error {
  // Os dois modelos já analisaram a mesma imagem. Repetir o mesmo fluxo tende a
  // gerar o mesmo resultado e apenas aumenta custo; a correção é manual/prompt.
  readonly retriable = false;

  constructor(message: string) {
    super(message);
    this.name = "AnaliseVisualQualidadeInsuficienteError";
  }
}

export async function analisarImagemEstampaComFallback(
  input: ImageAnalysisInput<AnaliseVisualEstampa>,
  primaryProvider: ImageAnalysisProvider,
  fallbackProvider: ImageAnalysisProvider,
): Promise<ImageAnalysisResult<AnaliseVisualEstampa>> {
  let motivoFallback: string | null = null;
  let tentativasPrimario = 0;

  for (let tentativa = 1; tentativa <= AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS; tentativa += 1) {
    tentativasPrimario = tentativa;
    try {
      const resultado = await primaryProvider.analyzeImage(input);
      const motivoConfianca = obterMotivoConfiancaInsuficiente(resultado.data);
      if (!motivoConfianca) return resultado;
      motivoFallback = motivoConfianca;
      break;
    } catch (error) {
      if (!erroElegivelParaFallback(error)) throw error;
      motivoFallback = codigoErroFallback(error);
      if (!erroEstruturalRepetivel(error) || tentativa === AI_PRIMARY_INVALID_RESPONSE_ATTEMPTS) {
        break;
      }
    }
  }

  console.warn("[estampas-ai] Acionando modelo fallback.", {
    primaryModel: primaryProvider.model,
    fallbackModel: fallbackProvider.model,
    reason: motivoFallback,
  });

  const resultadoFallback = await fallbackProvider.analyzeImage(input);
  const motivoConfiancaFallback = obterMotivoConfiancaInsuficiente(resultadoFallback.data);
  if (motivoConfiancaFallback) {
    throw new AnaliseVisualQualidadeInsuficienteError(
      `Fallback retornou confiança insuficiente (${motivoConfiancaFallback}); mínimo configurado ${AI_MIN_CONFIDENCE}.`,
    );
  }

  return {
    ...resultadoFallback,
    fallbackUsed: true,
    fallbackReason: motivoFallback,
    primaryModel: primaryProvider.model,
    primaryAttempts: tentativasPrimario,
  };
}

function obterMotivoConfiancaInsuficiente(analise: AnaliseVisualEstampa) {
  if (analise.confianca < AI_MIN_CONFIDENCE) {
    return `LOW_CONFIDENCE:${analise.confianca}`;
  }
  if (analise.confiancaTipoImagem < AI_MIN_CONFIDENCE) {
    return `LOW_PRESENTATION_CONFIDENCE:${analise.confiancaTipoImagem}`;
  }
  return null;
}

function erroEstruturalRepetivel(error: unknown) {
  return (
    error instanceof ImageAnalysisProviderError &&
    ["INVALID_RESPONSE", "INVALID_STRUCTURED_OUTPUT"].includes(error.code)
  );
}

function erroElegivelParaFallback(error: unknown) {
  return (
    error instanceof ImageAnalysisProviderError &&
    ["INVALID_RESPONSE", "INVALID_STRUCTURED_OUTPUT", "PROVIDER_ERROR"].includes(error.code)
  );
}

function codigoErroFallback(error: unknown) {
  return error instanceof ImageAnalysisProviderError ? `PRIMARY_ERROR:${error.code}` : "PRIMARY_ERROR";
}
