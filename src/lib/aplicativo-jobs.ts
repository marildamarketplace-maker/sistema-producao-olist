export const CHAVES_JOB = {
  BAIXA_ESTOQUE: "BAIXA_ESTOQUE",
  CONFIRMACAO_ENTREGA_PRODUCAO: "CONFIRMACAO_ENTREGA_PRODUCAO",
  NOTIFICAR: "NOTIFICAR",
  RENOVAR_TOKENS: "RENOVAR_TOKENS",
  VALIDADOR_ESTOQUE: "VALIDADOR_ESTOQUE",
} as const;

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
