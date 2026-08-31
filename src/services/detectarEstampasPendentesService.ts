import {
  listarEstampasParaVerificarAnalise,
  type EstampaCatalogo,
} from "@/repositories/catalogo-estampas-repository";
import {
  criarEstampaJobsEmLote,
  TipoJobEstampa,
} from "@/repositories/estampa-jobs-repository";
import { estampaPrecisaReprocessamento } from "@/services/controleVersaoAnaliseEstampa";
import { validarUrlPreviewEstampa } from "@/services/carregarPreviewEstampaService";

export type ResultadoDeteccaoEstampasPendentes = {
  encontradas: number;
  elegiveis: number;
  ignoradas: number;
  jobsCriados: number;
};

export type OpcoesDeteccaoEstampasPendentes = {
  tamanhoLote?: number;
};

function temPreviewValido(estampa: EstampaCatalogo) {
  if (!estampa.preview_url?.trim()) return false;

  try {
    validarUrlPreviewEstampa(estampa.preview_url);
    return true;
  } catch {
    return false;
  }
}

function estampaElegivel(estampa: EstampaCatalogo) {
  return temPreviewValido(estampa) && estampaPrecisaReprocessamento(estampa);
}

export async function detectarEstampasPendentes(
  options: OpcoesDeteccaoEstampasPendentes = {},
): Promise<ResultadoDeteccaoEstampasPendentes> {
  const tamanhoLote = options.tamanhoLote ?? 200;
  if (!Number.isInteger(tamanhoLote) || tamanhoLote <= 0 || tamanhoLote > 1000) {
    throw new Error("tamanhoLote deve ser um inteiro entre 1 e 1000.");
  }

  const resultado: ResultadoDeteccaoEstampasPendentes = {
    encontradas: 0,
    elegiveis: 0,
    ignoradas: 0,
    jobsCriados: 0,
  };
  let afterId: string | undefined;

  while (true) {
    const estampas = await listarEstampasParaVerificarAnalise({
      limite: tamanhoLote,
      afterId,
    });
    if (estampas.length === 0) break;

    resultado.encontradas += estampas.length;
    const candidatas = estampas.filter(estampaElegivel);
    const idsCandidatas = candidatas.map((estampa) => BigInt(String(estampa.id)));
    const criacao = await criarEstampaJobsEmLote(
      idsCandidatas,
      TipoJobEstampa.AI_ANALYSIS,
    );
    resultado.elegiveis += criacao.elegiveis;
    resultado.jobsCriados += criacao.jobsCriados;
    afterId = String(estampas.at(-1)?.id ?? "") || undefined;

    if (estampas.length < tamanhoLote) break;
  }

  resultado.ignoradas = resultado.encontradas - resultado.jobsCriados;
  console.info("[estampas] Detecção de pendências concluída.", resultado);
  return resultado;
}
