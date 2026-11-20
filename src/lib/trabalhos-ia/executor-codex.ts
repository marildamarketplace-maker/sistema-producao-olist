import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executarCodexCli } from "@/services/image-analysis/executarCodexCli";
import { ambienteWorkerCodex } from "@/lib/automatizacao/ambiente-worker-codex";
import type { TrabalhoWorkerIa } from "./contrato";

// O executor recebe dados e contrato; não conhece tabelas ou regras de um domínio.
export async function executarTextoCodex(trabalho: TrabalhoWorkerIa, signal: AbortSignal, executar = executarCodexCli) {
  const cwd = await mkdtemp(join(tmpdir(), "erp-trabalho-ia-"));
  try {
    const schema = join(cwd, "contrato.json"), saida = join(cwd, "resultado.json");
    await writeFile(schema, JSON.stringify(trabalho.schema), { mode: 0o600 });
    await executar({ executable: process.env.CODEX_CLI_PATH || "codex", cwd, signal,
      timeoutMs: trabalho.timeoutMs, env: ambienteWorkerCodex(), stdin: trabalho.prompt,
      args: ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
        "--color", "never", "--output-schema", schema, "--output-last-message", saida,
        "-c", 'approval_policy="never"', "-c", 'web_search="disabled"', "-c", 'forced_login_method="chatgpt"',
        ...["shell_tool", "unified_exec", "apps", "plugins", "memories", "multi_agent", "image_generation"]
          .flatMap(feature => ["-c", `features.${feature}=false`]), "-"],
    });
    if ((await stat(saida)).size > 240_000) throw new SyntaxError("RESPOSTA_ACIMA_DO_LIMITE");
    return JSON.parse(await readFile(saida, "utf8")) as unknown;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
