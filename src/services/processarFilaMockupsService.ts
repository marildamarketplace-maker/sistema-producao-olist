import { prisma } from "@/lib/prisma";
import { trabalhoFilaMockups } from "@/lib/fila-mockups";
import { interpretarIdMockup } from "@/lib/mockups";
import {
  registrarSaidaMockup, reagendarSaidaMockup,
  reservarSaidaMockup, type ReservaMockup, type SaidaMockup,
} from "@/repositories/fila-mockups-worker-repository";
import { carregarPreviewEstampa, CarregarPreviewEstampaError } from "@/services/carregarPreviewEstampaService";
import type { GeradorMockupCodex } from "@/services/gerarMockupCodexService";
import {
  getGoogleStorageObjectInfo, GoogleStorageServiceError, lerGoogleStorageImagemPrivada, uploadToGoogleStorage, verificarGoogleStorageBucketPrivado,
} from "@/services/googleStorageService";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const MAX_TENTATIVAS = 3;
const TIMEOUT_STORAGE = 45_000;
const MAX_MODELO_BYTES = 32 * 1024 * 1024;

type Opcoes = { aplicativoId: string; bucket: string; gerador: Pick<GeradorMockupCodex, "gerar"> };

export async function processarProximaSaidaMockup(opcoes: Opcoes) {
  const reserva = await reservarSaidaMockup(opcoes.aplicativoId);
  if (!reserva) return null;
  const dados = { loteId: reserva.id, saida: reserva.proximaSaida + 1 };
  let resultado: SaidaMockup;
  try {
    resultado = await gerarSaida(opcoes, reserva);
  } catch (error) {
    if (error instanceof ImageAnalysisProviderError && ["AUTHENTICATION_ERROR", "CONFIGURATION_ERROR"].includes(error.code)) {
      await reagendarSaidaMockup(reserva, 60_000, true);
      throw error;
    }
    if (error instanceof GoogleStorageServiceError && [401, 403].includes(error.status ?? 0)) {
      await reagendarSaidaMockup(reserva, 60_000, true);
      throw error;
    }
    const falha = classificarFalha(error);
    if (falha.repetir && reserva.tentativas < MAX_TENTATIVAS) {
      const ok = await reagendarSaidaMockup(reserva, 60_000 * 2 ** (reserva.tentativas - 1), false);
      return { ...dados, status: ok ? "RETRY" : "RESERVA_EXPIRADA", erro: falha.codigo };
    }
    resultado = { status: "FAILED", erro: falha.codigo };
  }
  const ok = await registrarSaidaMockup(reserva, resultado);
  return { ...dados, status: ok ? resultado.status : "RESERVA_EXPIRADA", erro: resultado.erro };
}

async function gerarSaida({ bucket, gerador }: Opcoes, reserva: ReservaMockup): Promise<SaidaMockup> {
  const trabalho = trabalhoFilaMockups.safeParse(reserva.trabalhos[reserva.proximaSaida]);
  if (!trabalho.success) return { status: "FAILED", erro: "COMBINACAO_INVALIDA" };
  const { mockupId, estampaIds } = trabalho.data;
  const path = `mockups-gerados/${reserva.aplicativoId}/${reserva.solicitadoPor}/${reserva.id}/${reserva.proximaSaida + 1}.webp`;
  if ((await getGoogleStorageObjectInfo(path, bucket, AbortSignal.timeout(TIMEOUT_STORAGE))).exists) {
    return { status: "COMPLETED", bucket, path };
  }
  if (reserva.tentativas > MAX_TENTATIVAS) return { status: "FAILED", erro: "TENTATIVAS_ESGOTADAS" };

  const estampas = await prisma.estampaCatalogoIa.findMany({
    where: { id: { in: estampaIds.map(BigInt) }, isActive: true },
    select: { id: true, previewUrl: true },
  });
  const porId = new Map(estampas.map((item) => [String(item.id), item]));
  const ordenadas = estampaIds.map((id) => porId.get(id));
  if (ordenadas.some((item) => !item?.previewUrl)) return { status: "FAILED", erro: "ESTAMPA_SEM_PREVIEW" };

  const [modelo, ...artes] = await Promise.all([
    carregarModelo(bucket, `mockups/${reserva.aplicativoId}/${mockupId}.webp`),
    ...ordenadas.map(async (item) => (await carregarPreviewEstampa({
      id: String(item!.id), preview_url: item!.previewUrl,
    })).buffer),
  ]);
  const gerada = await gerador.gerar(modelo, artes, interpretarIdMockup(mockupId)?.tipo === "LAYOUT");
  try {
    await verificarGoogleStorageBucketPrivado(bucket, AbortSignal.timeout(TIMEOUT_STORAGE));
    await uploadToGoogleStorage({
      bucket, path, buffer: gerada.buffer, contentType: "image/webp", somenteNovo: true,
      signal: AbortSignal.timeout(TIMEOUT_STORAGE),
    });
  } catch (error) {
    if (!(error instanceof GoogleStorageServiceError) || error.status !== 412) throw error;
    return { status: "COMPLETED", bucket, path };
  }
  return {
    status: "COMPLETED", bucket, path, width: gerada.width, height: gerada.height,
    bytes: gerada.buffer.length, threadId: gerada.threadId,
  };
}

async function carregarModelo(bucket: string, path: string) {
  const stream = await lerGoogleStorageImagemPrivada(bucket, path, "image/webp", AbortSignal.timeout(TIMEOUT_STORAGE));
  const reader = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(partes, total);
      total += value.byteLength;
      if (total > MAX_MODELO_BYTES) {
        await reader.cancel();
        throw new GoogleStorageServiceError("Modelo excede 32 MiB.", { status: 413 });
      }
      partes.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function classificarFalha(error: unknown) {
  if (error instanceof ImageAnalysisProviderError || error instanceof CarregarPreviewEstampaError) {
    return { codigo: error.code, repetir: error.retriable };
  }
  if (error instanceof GoogleStorageServiceError) {
    const status = error.status;
    return { codigo: status === 404 ? "MOCKUP_INDISPONIVEL" : "ARMAZENAMENTO", repetir: status === 429 || (status ?? 0) >= 500 };
  }
  return { codigo: "FALHA_TEMPORARIA", repetir: true };
}
