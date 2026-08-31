import { buscarEstampaPorId } from "@/repositories/catalogo-estampas-repository";
import { criarJobReprocessamentoManual } from "@/repositories/estampa-jobs-repository";

export class EstampaNaoEncontradaParaReprocessamentoError extends Error {
  constructor(estampaId: string) {
    super(`Estampa ${estampaId} não encontrada.`);
    this.name = "EstampaNaoEncontradaParaReprocessamentoError";
  }
}

export async function solicitarReprocessamentoIaEstampa(
  estampaId: string,
  solicitadoPor?: string | null,
) {
  const id = estampaId.trim();
  if (!id) throw new Error("estampaId é obrigatório.");

  const estampa = await buscarEstampaPorId(id);
  if (!estampa) throw new EstampaNaoEncontradaParaReprocessamentoError(id);

  const job = await criarJobReprocessamentoManual(id, solicitadoPor);
  console.info("[estampas] Reprocessamento manual solicitado.", {
    jobId: job.id,
    estampaId: id,
    solicitadoPor: solicitadoPor ?? null,
    solicitadoEm: job.manualRequestedAt?.toISOString() ?? null,
  });
  return job;
}
