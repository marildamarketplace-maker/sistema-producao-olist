import { ambienteCodexCli } from "@/services/image-analysis/executarCodexCli";

// Preserva a sessão do usuário do serviço, sem encaminhar secrets do ERP.
export function ambienteWorkerCodex(source: NodeJS.ProcessEnv = process.env) {
  const env = ambienteCodexCli({
    NODE_ENV: "production", PATH: source.PATH, HOME: source.HOME,
    CODEX_HOME: source.CODEX_HOME,
  });
  if (!env.HOME) throw new Error("HOME_CODEX_AUSENTE");
  return env;
}
