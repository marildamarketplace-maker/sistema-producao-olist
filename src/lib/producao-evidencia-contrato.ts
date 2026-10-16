export const MAX_FOTO_EVIDENCIA_BYTES = 3 * 1024 * 1024;
export const MAX_DIMENSAO_FOTO_EVIDENCIA = 1600;
export const MAX_CORPO_CONFIRMACAO_BYTES = 4 * 1024 * 1024;

export class EvidenciaProducaoError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "EvidenciaProducaoError";
  }
}
