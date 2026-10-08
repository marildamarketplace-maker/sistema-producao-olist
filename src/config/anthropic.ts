export function obterConfiguracaoAnthropic() {
  const numero = (name: string, padrao: number, min: number, max: number) => {
    const valor = process.env[name]?.trim();
    const parsed = valor ? Number(valor) : padrao;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} inválida.`);
    return parsed;
  };
  return { timeoutMs: numero("ANTHROPIC_IMAGE_ANALYSIS_TIMEOUT_MS", 90000, 1000, 300000), maxOutputTokens: numero("ANTHROPIC_MAX_OUTPUT_TOKENS", 4096, 300, 16384) };
}
