export const CHAVES_JOB = {
  ANOTAR_SKU: "ANOTAR_SKU",
  AUDITORIA_ESTOQUE_REFERENCIAS: "AUDITORIA_ESTOQUE_REFERENCIAS",
  BAIXA_ESTOQUE: "BAIXA_ESTOQUE",
  CONFIRMACAO_ENTREGA_PRODUCAO: "CONFIRMACAO_ENTREGA_PRODUCAO",
  NOTIFICAR: "NOTIFICAR",
  RENOVAR_TOKENS: "RENOVAR_TOKENS",
  AGENDAR_SINCRONIZACAO_OLIST: "AGENDAR_SINCRONIZACAO_OLIST",
  AUDITAR_SINCRONIZACAO_OLIST: "AUDITAR_SINCRONIZACAO_OLIST",
  APLICAR_SINCRONIZACAO_OLIST: "APLICAR_SINCRONIZACAO_OLIST",
  LIMPAR_HISTORICO_SINCRONIZACAO_OLIST: "LIMPAR_HISTORICO_SINCRONIZACAO_OLIST",
  VALIDADOR_ESTOQUE: "VALIDADOR_ESTOQUE",
} as const;

export const CHAVE_CONFIG_JOB_ANOTAR_SKU = "processar-anotar-sku";

export type ChaveJob = typeof CHAVES_JOB[keyof typeof CHAVES_JOB];

export function listarChavesJobs(jobs: string | null | undefined) {
  return new Set(
    (jobs ?? "")
      .split(",")
      .map((chave) => chave.trim().toUpperCase())
      .filter(Boolean),
  );
}

export function aplicativoTemJob(
  jobs: string | null | undefined,
  chave: ChaveJob,
) {
  return listarChavesJobs(jobs).has(chave);
}
