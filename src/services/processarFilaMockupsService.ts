import { prisma } from "@/lib/prisma";
import { trabalhoFilaMockups } from "@/lib/fila-mockups";
import { camposEstampaPrompt, descreverEstampaMockup } from "@/lib/prompt-fila-mockups";
import { interpretarIdMockup } from "@/lib/mockups";
import {
  registrarSaidaMockup, reagendarSaidaMockup,
  reservarSaidaMockup, type ReservaMockup, type SaidaMockup,
} from "@/repositories/fila-mockups-worker-repository";
import { carregarPreviewEstampa, CarregarPreviewEstampaError } from "@/services/carregarPreviewEstampaService";
import type { GeradorMockupCodex } from "@/services/gerarMockupCodexService";
import { MockupBlobStorageError, mockupBlobStorage } from "@/services/mockupBlobStorageService";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const MAX_TENTATIVAS = 3;
const TIMEOUT_STORAGE = 45_000;
const MAX_MODELO_BYTES = 32 * 1024 * 1024;

type ArmazenamentoMockups = Pick<typeof mockupBlobStorage, "existe" | "ler" | "enviar">;
type Opcoes = { storeId: string; gerador: Pick<GeradorMockupCodex, "gerar">; storage?: ArmazenamentoMockups };

export async function processarProximaSaidaMockup(opcoes: Opcoes) {
  const armazenamento = opcoes.storage ?? mockupBlobStorage;
  const reserva = await reservarSaidaMockup();
  if (!reserva) return null;
  const dados = { aplicativoId: reserva.aplicativoId, loteId: reserva.id, saida: reserva.proximaSaida + 1 };
  let resultado: SaidaMockup;
  try {
    resultado = await gerarSaida(opcoes, armazenamento, reserva);
  } catch (error) {
    if (error instanceof ImageAnalysisProviderError && ["AUTHENTICATION_ERROR", "CONFIGURATION_ERROR"].includes(error.code)) {
      await reagendarSaidaMockup(reserva, 60_000, true);
      throw error;
    }
    if (error instanceof MockupBlobStorageError && [401, 403].includes(error.status ?? 0)) {
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

async function gerarSaida({ storeId, gerador }: Opcoes, armazenamento: ArmazenamentoMockups, reserva: ReservaMockup): Promise<SaidaMockup> {
  const trabalho = trabalhoFilaMockups.safeParse(reserva.trabalhos[reserva.proximaSaida]);
  if (!trabalho.success) return { status: "FAILED", erro: "COMBINACAO_INVALIDA" };
  const { mockupId, estampaIds } = trabalho.data;
  const path = `mockups-gerados/${reserva.aplicativoId}/${reserva.solicitadoPor}/${reserva.id}/${reserva.proximaSaida + 1}.webp`;
  if (await armazenamento.existe(path)) {
    return { status: "COMPLETED", bucket: storeId, path };
  }
  if (reserva.tentativas > MAX_TENTATIVAS) return { status: "FAILED", erro: "TENTATIVAS_ESGOTADAS" };

  const estampas = await prisma.estampaCatalogoIa.findMany({
    where: { id: { in: estampaIds.map(BigInt) }, isActive: true },
    select: camposEstampaPrompt,
  });
  const porId = new Map(estampas.map((item) => [String(item.id), item]));
  const ordenadas = estampaIds.map((id) => porId.get(id)).filter((item) => item !== undefined);
  if (ordenadas.length !== estampaIds.length || ordenadas.some((item) => !item.previewUrl)) return { status: "FAILED", erro: "ESTAMPA_SEM_PREVIEW" };

  const [modelo, ...artes] = await Promise.all([
    carregarModelo(armazenamento, `mockups/${reserva.aplicativoId}/${mockupId}.webp`),
    ...ordenadas.map(async (item) => (await carregarPreviewEstampa({
      id: String(item.id), preview_url: item.previewUrl,
    })).buffer),
  ]);
  const gerada = await gerador.gerar(modelo, artes, interpretarIdMockup(mockupId)?.tipo === "LAYOUT", {
    observacao: reserva.observacao,
    estampas: ordenadas.map(descreverEstampaMockup),
  });
  try {
    await armazenamento.enviar({
      path, buffer: gerada.buffer, contentType: "image/webp", somenteNovo: true,
      signal: AbortSignal.timeout(TIMEOUT_STORAGE),
    });
  } catch (error) {
    if (!(error instanceof MockupBlobStorageError) || error.status !== 412) throw error;
    return { status: "COMPLETED", bucket: storeId, path };
  }
  return {
    status: "COMPLETED", bucket: storeId, path, width: gerada.width, height: gerada.height,
    bytes: gerada.buffer.length, threadId: gerada.threadId,
  };
}

async function carregarModelo(armazenamento: ArmazenamentoMockups, path: string) {
  const stream = await armazenamento.ler(path, "image/webp", AbortSignal.timeout(TIMEOUT_STORAGE));
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
        throw new MockupBlobStorageError("Modelo excede 32 MiB.", 413);
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
  if (error instanceof MockupBlobStorageError) {
    const status = error.status;
    return { codigo: status === 404 ? "MOCKUP_INDISPONIVEL" : "ARMAZENAMENTO", repetir: status === 429 || (status ?? 0) >= 500 };
  }
  return { codigo: "FALHA_TEMPORARIA", repetir: true };
}
