import type {
  AtualizacaoEstampaCatalogo,
  JsonValue,
} from "@/repositories/catalogo-estampas-repository";
import type { AnaliseVisualEstampa } from "@/schemas/analiseVisualEstampaSchema";
import type { ImageAnalysisResult } from "@/services/image-analysis/ImageAnalysisProvider";
import { normalizarTaxonomiasAnalise } from "@/services/normalizarTaxonomiaEstampa";
import {
  AI_MIN_SEGMENTATION_CONFIDENCE,
  AI_MIN_TEXTILE_PATTERN_CONFIDENCE,
} from "@/config/ai";

export function criarAtualizacaoResultadoAnaliseIa(
  resultado: ImageAnalysisResult<AnaliseVisualEstampa>,
  manual: {
    manualRequested?: boolean;
    manualRequestedAt?: Date | null;
    manualRequestedBy?: string | null;
  } = {},
): AtualizacaoEstampaCatalogo {
  const analise = normalizarTaxonomiasAnalise(resultado.data);
  const segmentacao = materializarSegmentacaoBusca(
    analise,
    AI_MIN_SEGMENTATION_CONFIDENCE,
  );
  const classificacaoTextil = materializarClassificacaoTextil(
    analise,
    AI_MIN_TEXTILE_PATTERN_CONFIDENCE,
  );
  const aiMetadata: JsonValue = {
    provider: resultado.provider,
    model: resultado.model,
    prompt_version: resultado.promptVersion,
    confidence: analise.confianca,
    presentation_confidence: analise.confiancaTipoImagem,
    analyzed_at: resultado.analyzedAt,
    fallback_used: resultado.fallbackUsed,
    fallback_reason: resultado.fallbackReason,
    primary_model: resultado.primaryModel,
    primary_attempts: resultado.primaryAttempts,
    image_detail: resultado.imageDetail ?? null,
    manual_reprocessing: manual.manualRequested === true,
    manual_requested_at: manual.manualRequestedAt?.toISOString() ?? null,
    manual_requested_by: manual.manualRequestedBy ?? null,
    request_id: resultado.requestId,
    usage: {
      input_tokens: resultado.usage.inputTokens,
      output_tokens: resultado.usage.outputTokens,
      total_tokens: resultado.usage.totalTokens,
      cached_input_tokens: resultado.usage.cachedInputTokens ?? null,
    },
    response: analise as unknown as JsonValue,
  };

  return {
    titulo: analise.titulo,
    descricao: analise.descricao,
    tema: analise.tema,
    subtemas: analise.subtemas,
    palavras_chave: analise.palavrasChave,
    cores: [...new Set([...analise.coresPrincipais, ...analise.coresSecundarias])],
    elementos_visuais: analise.elementosVisuais,
    ocasioes: analise.ocasioes,
    categorias: analise.categorias,
    estilo: analise.estilo,
    tipo_imagem: analise.tipoImagem,
    conteudos_imagem: analise.conteudosImagem,
    suporte_aplicacao: analise.aplicacaoVisual.suporte,
    descricao_aplicacao: analise.aplicacaoVisual.descricao,
    confianca_tipo_imagem: analise.confiancaTipoImagem,
    publicos_sugeridos: segmentacao.publicosSugeridos,
    contextos_uso: segmentacao.contextosUso,
    afinidades_visuais: segmentacao.afinidadesVisuais,
    confianca_segmentacao: segmentacao.confianca,
    padroes_texteis: classificacaoTextil.padroes,
    confianca_padrao_textil: classificacaoTextil.confianca,
    ai_metadata: aiMetadata,
    processed_at: resultado.analyzedAt,
    processing_error: null,
  };
}

export function materializarClassificacaoTextil(
  analise: AnaliseVisualEstampa,
  confiancaMinima: number,
) {
  const aceitos = analise.classificacaoTextil.padroesTexteis.filter(
    (item) => item.confianca >= confiancaMinima,
  );
  return {
    padroes: aceitos.map((item) => item.termo),
    confianca:
      aceitos.length === 0
        ? null
        : aceitos.reduce((total, item) => total + item.confianca, 0) / aceitos.length,
  };
}

export function materializarSegmentacaoBusca(
  analise: AnaliseVisualEstampa,
  confiancaMinima: number,
) {
  const aceitas = <T extends { termo: string; confianca: number }>(itens: T[]) =>
    itens.filter((item) => item.confianca >= confiancaMinima);
  const publicos = aceitas(analise.segmentacaoBusca.publicosSugeridos);
  const contextos = aceitas(analise.segmentacaoBusca.contextosUso);
  const afinidades = aceitas(analise.segmentacaoBusca.afinidadesVisuais);
  const todas = [...publicos, ...contextos, ...afinidades];

  return {
    publicosSugeridos: publicos.map((item) => item.termo),
    contextosUso: contextos.map((item) => item.termo),
    afinidadesVisuais: afinidades.map((item) => item.termo),
    confianca:
      todas.length === 0
        ? null
        : todas.reduce((total, item) => total + item.confianca, 0) / todas.length,
  };
}
