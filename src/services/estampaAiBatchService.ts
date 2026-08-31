import { StatusEstampaAiBatch } from "@prisma/client";
import { AI_BATCH_ENABLED, AI_BATCH_MAX_JOBS } from "@/config/ai";
import {
  atualizarEstadoProviderBatch,
  buscarJobBatchPorCustomId,
  confirmarEnvioBatchEstampas,
  concluirJobBatch,
  desfazerPreparacaoBatchEstampas,
  falharJobBatch,
  listarBatchesAguardandoProvider,
  prepararBatchEstampas,
} from "@/repositories/estampa-ai-batches-repository";
import { atualizarEstampa, buscarEstampaPorId } from "@/repositories/catalogo-estampas-repository";
import {
  AI_ANALYSIS_PROMPT_VERSION,
  AI_MIN_CONFIDENCE,
  AI_PRIMARY_MODEL,
} from "@/config/ai";
import { validarAnaliseVisualEstampa } from "@/schemas/analiseVisualEstampaSchema";
import type { ImageAnalysisResult } from "@/services/image-analysis/ImageAnalysisProvider";
import { criarAtualizacaoResultadoAnaliseIa } from "@/services/mapearResultadoAnaliseIaEstampa";
import { OpenAIBatchClient, type OpenAIBatch } from "@/services/image-analysis/OpenAIBatchClient";
import {
  criarLinhaBatchAnaliseEstampa,
  serializarLinhasBatch,
} from "@/services/image-analysis/criarRequisicaoBatchAnaliseEstampa";

export async function enviarProximoBatchEstampas(
  workerId: string,
  client = new OpenAIBatchClient(),
) {
  if (!AI_BATCH_ENABLED) {
    throw new Error("Batch de estampas está desativado. Defina AI_BATCH_ENABLED=true explicitamente.");
  }
  const preparado = await prepararBatchEstampas(AI_BATCH_MAX_JOBS, workerId);
  if (!preparado) return null;
  try {
    const linhas = preparado.itens.map((item) => criarLinhaBatchAnaliseEstampa({
      customId: item.customId,
      previewUrl: item.previewUrl,
    }));
    const inputFileId = await client.enviarArquivoJsonl(serializarLinhasBatch(linhas));
    const providerBatch = await client.criarBatch(inputFileId, {
      local_batch_id: preparado.batchId,
      prompt_version: AI_ANALYSIS_PROMPT_VERSION,
    });
    await confirmarEnvioBatchEstampas({
      batchId: preparado.batchId,
      providerBatchId: providerBatch.id,
      inputFileId,
    });
    return { batchId: preparado.batchId, providerBatchId: providerBatch.id, quantidade: linhas.length };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Falha ao enviar batch.";
    await desfazerPreparacaoBatchEstampas(preparado.batchId, mensagem);
    throw error;
  }
}

export async function sincronizarBatchesEstampas(client = new OpenAIBatchClient()) {
  const batches = await listarBatchesAguardandoProvider();
  const resultados = [];
  for (const batch of batches) {
    if (!batch.providerBatchId) continue;
    const providerBatch = await client.buscarBatch(batch.providerBatchId);
    let status = mapearStatus(providerBatch);
    if (status === StatusEstampaAiBatch.COMPLETED && providerBatch.output_file_id) {
      const conteudo = await client.baixarArquivo(providerBatch.output_file_id);
      const processamento = await processarArquivoResultadoBatch(batch.id, conteudo);
      status = processamento.falhas === 0
        ? StatusEstampaAiBatch.COMPLETED
        : StatusEstampaAiBatch.FAILED;
    }
    await atualizarEstadoProviderBatch({
      batchId: batch.id,
      status,
      outputFileId: providerBatch.output_file_id,
      errorFileId: providerBatch.error_file_id,
      concluidos: providerBatch.request_counts?.completed ?? 0,
      falhas: providerBatch.request_counts?.failed ?? 0,
      erro: providerBatch.errors ? JSON.stringify(providerBatch.errors) : null,
    });
    resultados.push({ batchId: batch.id, providerBatchId: batch.providerBatchId, status });
  }
  return resultados;
}

type LinhaResultadoBatch = {
  custom_id?: string;
  response?: {
    status_code?: number;
    request_id?: string;
    body?: {
      id?: string;
      model?: string;
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
  };
  error?: unknown;
};

export async function processarArquivoResultadoBatch(batchId: string, conteudo: string) {
  let concluidos = 0;
  let falhas = 0;
  const linhas = conteudo.split(/\r?\n/u).filter(Boolean);
  for (const linhaTexto of linhas) {
    let linha: LinhaResultadoBatch;
    try {
      linha = JSON.parse(linhaTexto) as LinhaResultadoBatch;
    } catch {
      falhas += 1;
      continue;
    }
    const customId = linha.custom_id?.trim();
    if (!customId) {
      falhas += 1;
      continue;
    }
    const job = await buscarJobBatchPorCustomId(batchId, customId);
    if (!job) continue; // replay idempotente: item já concluído ou desconhecido
    try {
      if (linha.error || (linha.response?.status_code ?? 500) >= 400) {
        throw new Error(`Provider rejeitou item: ${JSON.stringify(linha.error ?? linha.response)}`);
      }
      const body = linha.response?.body;
      const texto = extrairTextoBatch(body);
      if (!body || !texto) throw new Error("Resultado Batch sem saída estruturada.");
      const analise = validarAnaliseVisualEstampa(JSON.parse(texto));
      if (
        analise.confianca < AI_MIN_CONFIDENCE ||
        analise.confiancaTipoImagem < AI_MIN_CONFIDENCE
      ) {
        throw new Error("Resultado Batch requer fallback por confiança insuficiente.");
      }
      const estampa = await buscarEstampaPorId(job.estampaId);
      if (!estampa) throw new Error("Estampa do resultado Batch não encontrada.");
      if (!estampa.content_hash || estampa.content_hash !== extrairHashCustomId(customId)) {
        throw new Error("A versão da estampa mudou enquanto o Batch estava em execução.");
      }
      const resultado: ImageAnalysisResult<typeof analise> = {
        provider: "openai",
        model: body.model || AI_PRIMARY_MODEL,
        analyzedAt: new Date().toISOString(),
        promptVersion: AI_ANALYSIS_PROMPT_VERSION,
        fallbackUsed: false,
        fallbackReason: null,
        primaryModel: AI_PRIMARY_MODEL,
        primaryAttempts: 1,
        imageDetail: "low",
        data: analise,
        requestId: body.id || linha.response?.request_id || null,
        usage: {
          inputTokens: body.usage?.input_tokens ?? null,
          outputTokens: body.usage?.output_tokens ?? null,
          totalTokens: body.usage?.total_tokens ?? null,
          cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? null,
        },
      };
      const atualizacao = criarAtualizacaoResultadoAnaliseIa(resultado, {
        manualRequested: job.manualRequested,
        manualRequestedAt: job.manualRequestedAt,
        manualRequestedBy: job.manualRequestedBy,
      });
      atualizacao.ai_processed_hash = estampa.content_hash;
      atualizacao.processing_status = "COMPLETED";
      const atualizada = await atualizarEstampa(estampa.id, atualizacao, {
        contentHashEsperado: estampa.content_hash,
      });
      if (!atualizada) throw new Error("Estampa mudou antes da persistência do Batch.");
      await concluirJobBatch(job.id, batchId, estampa.content_hash);
      concluidos += 1;
    } catch (error) {
      falhas += 1;
      await falharJobBatch(
        job.id,
        batchId,
        error instanceof Error ? error.message : "Falha ao importar resultado Batch.",
      );
    }
  }
  return { concluidos, falhas };
}

function extrairTextoBatch(
  body: NonNullable<LinhaResultadoBatch["response"]>["body"],
) {
  if (body?.output_text?.trim()) return body.output_text.trim();
  return (body?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim())
    .filter((item): item is string => Boolean(item))
    .join("\n")
    .trim();
}

function extrairHashCustomId(customId: string) {
  const match = /:hash:([^:]+):prompt:/u.exec(customId);
  return match?.[1] ?? "";
}

function mapearStatus(batch: OpenAIBatch): StatusEstampaAiBatch {
  if (batch.status === "completed") return StatusEstampaAiBatch.COMPLETED;
  if (batch.status === "failed") return StatusEstampaAiBatch.FAILED;
  if (batch.status === "expired") return StatusEstampaAiBatch.EXPIRED;
  if (batch.status === "cancelled") return StatusEstampaAiBatch.CANCELLED;
  if (batch.status === "validating") return StatusEstampaAiBatch.SUBMITTED;
  return StatusEstampaAiBatch.IN_PROGRESS;
}
