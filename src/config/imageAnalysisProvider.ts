import { parseArgs } from "node:util";

export type NomeImageAnalysisProvider = "openai" | "codex-local";

export function obterNomeImageAnalysisProvider(value = process.env.IMAGE_ANALYSIS_PROVIDER): NomeImageAnalysisProvider {
  const name = value?.trim().toLowerCase() || "openai";
  if (name !== "openai" && name !== "codex-local") {
    throw new Error("Provider de análise visual inválido. Use openai ou codex-local.");
  }
  return name;
}

export function lerOpcoesEstampasWorker(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      provider: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    help: values.help === true,
    provider: obterNomeImageAnalysisProvider(values.provider ?? env.IMAGE_ANALYSIS_PROVIDER),
  };
}
