import type { EstampaJob } from "@prisma/client";
import {
  atualizarEstampa,
  type EstampaCatalogo,
} from "@/repositories/catalogo-estampas-repository";
import { analisarVisualEstampa } from "@/services/analisarVisualEstampaService";
import { normalizarHashConteudo } from "@/services/controleVersaoAnaliseEstampa";
import { criarAtualizacaoResultadoAnaliseIa } from "@/services/mapearResultadoAnaliseIaEstampa";

export type ResultadoProcessamentoAnaliseIaEstampa = {
  aiProcessedHash: string;
};

export type ProcessadorAnaliseIaEstampa = (
  estampa: EstampaCatalogo,
  job: EstampaJob,
) => Promise<ResultadoProcessamentoAnaliseIaEstampa>;

export const processarAnaliseIaEstampa: ProcessadorAnaliseIaEstampa = async (
  estampa,
  job,
) => {
  const contentHash = normalizarHashConteudo(estampa.content_hash);
  if (!contentHash) {
    throw new Error(`Estampa ${estampa.id} não possui content_hash válido.`);
  }

  console.info("[estampas-worker] Iniciando carregamento do preview e análise visual.", {
    jobId: job.id,
    estampaId: estampa.id,
  });
  const resultado = await analisarVisualEstampa(estampa);
  console.info("[estampas-worker] Resposta da IA validada; persistindo metadados.", {
    jobId: job.id,
    estampaId: estampa.id,
    provider: resultado.provider,
    model: resultado.model,
    confidence: resultado.data.confianca,
    presentationConfidence: resultado.data.confiancaTipoImagem,
    fallbackUsed: resultado.fallbackUsed,
  });
  const atualizacao = criarAtualizacaoResultadoAnaliseIa(resultado, {
    manualRequested: job.manualRequested,
    manualRequestedAt: job.manualRequestedAt,
    manualRequestedBy: job.manualRequestedBy,
  });
  atualizacao.ai_processed_hash = contentHash;
  const atualizada = await atualizarEstampa(estampa.id, atualizacao, {
    contentHashEsperado: contentHash,
  });

  if (!atualizada) {
    throw new Error(`Estampa ${estampa.id} deixou de existir antes da persistência da análise.`);
  }

  console.info("[estampas-worker] Resultado da IA persistido no registro original.", {
    jobId: job.id,
    estampaId: estampa.id,
    provider: resultado.provider,
    model: resultado.model,
    fallbackUsed: resultado.fallbackUsed,
    promptVersion: resultado.promptVersion,
  });

  return { aiProcessedHash: contentHash };
};

export const processarAnaliseIaEstampaStub: ProcessadorAnaliseIaEstampa = async (
  estampa,
  job,
) => {
  const contentHash = normalizarHashConteudo(estampa.content_hash);
  if (!contentHash) {
    throw new Error(`Estampa ${estampa.id} não possui content_hash válido.`);
  }

  console.info("[estampas-worker] Processador stub executado.", {
    jobId: job.id,
    estampaId: estampa.id,
    previewUrl: estampa.preview_url,
  });

  return { aiProcessedHash: contentHash };
};
