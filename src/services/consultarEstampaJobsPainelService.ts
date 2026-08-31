import { StatusJobEstampa } from "@prisma/client";
import {
  listarEstampaJobsPainel,
  type EstampaJobPainelRow,
} from "@/repositories/estampa-jobs-repository";

export type EstampaJobPainel = {
  id: string;
  estampaId: string;
  codigo: string;
  variante: string | null;
  previewUrl: string | null;
  status: StatusJobEstampa;
  tentativas: number;
  maxTentativas: number;
  ultimoErro: string | null;
  criadoEm: string;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  processamentoManual: boolean;
  analise: {
    modelo: string | null;
    provider: string | null;
    confianca: number | null;
    analisadoEm: string | null;
    fallbackUtilizado: boolean | null;
    resultado: unknown | null;
  } | null;
};

export async function consultarEstampaJobsPainel(input: {
  status?: StatusJobEstampa;
  limite?: number;
  offset?: number;
}) {
  const resultado = await listarEstampaJobsPainel(input);
  return { ...resultado, jobs: resultado.jobs.map(paraJobPainel) };
}

function paraJobPainel(job: EstampaJobPainelRow): EstampaJobPainel {
  const metadata = objeto(job.aiMetadata);
  const modelo = texto(metadata?.model);
  const provider = texto(metadata?.provider);
  const confianca = numero(metadata?.confidence);
  const analisadoEm = texto(metadata?.analyzed_at) ?? job.processedAt?.toISOString() ?? null;
  const fallbackUtilizado = booleano(metadata?.fallback_used);
  const resultado = metadata?.response ?? null;
  const possuiAnalise = Boolean(modelo || provider || analisadoEm || resultado);

  return {
    id: job.id,
    estampaId: job.estampaId.toString(),
    codigo: job.codigo,
    variante: job.variante,
    previewUrl: job.previewUrl,
    status: job.status,
    tentativas: job.tentativas,
    maxTentativas: job.maxTentativas,
    ultimoErro: job.status === StatusJobEstampa.FAILED ? job.ultimoErro : null,
    criadoEm: job.createdAt.toISOString(),
    iniciadoEm: job.startedAt?.toISOString() ?? null,
    finalizadoEm: job.finishedAt?.toISOString() ?? null,
    processamentoManual: job.manualRequested,
    analise: possuiAnalise
      ? { modelo, provider, confianca, analisadoEm, fallbackUtilizado, resultado }
      : null,
  };
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function texto(valor: unknown) {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

function numero(valor: unknown) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function booleano(valor: unknown) {
  return typeof valor === "boolean" ? valor : null;
}
