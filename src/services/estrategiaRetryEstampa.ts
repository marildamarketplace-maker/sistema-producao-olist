const DEFAULT_BASE_DELAY_MS = 10_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

export const ESTAMPA_RETRY_BASE_DELAY_MS = inteiroPositivoEnv(
  "ESTAMPA_RETRY_BASE_DELAY_MS",
  DEFAULT_BASE_DELAY_MS,
);

export const ESTAMPA_RETRY_MAX_DELAY_MS = inteiroPositivoEnv(
  "ESTAMPA_RETRY_MAX_DELAY_MS",
  DEFAULT_MAX_DELAY_MS,
);

if (ESTAMPA_RETRY_MAX_DELAY_MS < ESTAMPA_RETRY_BASE_DELAY_MS) {
  throw new Error("ESTAMPA_RETRY_MAX_DELAY_MS não pode ser menor que o atraso base.");
}

export function calcularBackoffRetryMs(tentativasRealizadas: number): number {
  if (!Number.isInteger(tentativasRealizadas) || tentativasRealizadas <= 0) {
    throw new Error("tentativasRealizadas deve ser um inteiro maior que zero.");
  }

  return Math.min(
    ESTAMPA_RETRY_MAX_DELAY_MS,
    ESTAMPA_RETRY_BASE_DELAY_MS * 2 ** (tentativasRealizadas - 1),
  );
}

function inteiroPositivoEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} deve ser um inteiro maior que zero.`);
  }
  return parsed;
}
