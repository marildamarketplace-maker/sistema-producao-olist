import { tmpdir } from "node:os";
import { setTimeout as esperar } from "node:timers/promises";
import { criarClienteFilaWorker } from "@/lib/automatizacao/cliente-fila-worker";
import { ambienteWorkerCodex } from "@/lib/automatizacao/ambiente-worker-codex";
import { executarCodexCli } from "@/services/image-analysis/executarCodexCli";
import { PROTOCOLO_IA, respostaReservaIaSchema, TIPO_RELATORIO_SKU } from "@/lib/trabalhos-ia/contrato";
import { executarTextoCodex } from "@/lib/trabalhos-ia/executor-codex";
import { consumirEtapaIa } from "@/lib/trabalhos-ia/worker";

const parar = new AbortController();
process.once("SIGTERM", () => parar.abort());
process.once("SIGINT", () => parar.abort());
async function main() {
  const destino = new URL("/api/interno/trabalhos-ia", process.env.TRABALHOS_IA_ERP_URL ?? process.env.AUTOMATIZACAO_ERP_URL);
  const token = process.env.TRABALHOS_IA_WORKER_TOKEN;
  const versao = process.env.AUTOMATIZACAO_CODEX_VERSION;
  const tipos = (process.env.TRABALHOS_IA_TIPOS ?? TIPO_RELATORIO_SKU).split(",").map(t => t.trim()).filter(Boolean);
  if (destino.protocol !== "https:" || !token || !versao || !tipos.length || tipos.length > 20) throw new Error("CONFIGURACAO");
  const { stdout } = await executarCodexCli({ executable: process.env.CODEX_CLI_PATH || "codex", args: ["--version"], cwd: tmpdir(), timeoutMs: 10_000, env: ambienteWorkerCodex() });
  if (stdout.trim().split(/\s+/).at(-1) !== versao) throw new Error("VERSAO_CODEX");
  const api = criarClienteFilaWorker({ destino, token, registrarFalha: evento => console.error(evento) });
  let falhas = 0;
  console.info("[trabalhos-ia] Worker iniciado; aguardando solicitações.");
  while (!parar.signal.aborted) {
    try {
      const iniciadaEm = performance.now();
      const { trabalho, aguardarMs } = respostaReservaIaSchema.parse(await api({ acao: "reservar", protocolo: PROTOCOLO_IA, tipos }));
      falhas = 0;
      if (trabalho) {
        console.info(JSON.stringify({ etapa: trabalho.fase, tipo: trabalho.tipo }));
        const resultado = await consumirEtapaIa({ trabalho, iniciadaEm, signal: parar.signal, api, executar: executarTextoCodex });
        console.info(JSON.stringify({ etapa: "ETAPA_ENCERRADA", confirmada: resultado !== null }));
      } else if (aguardarMs) await esperar(aguardarMs, undefined, { signal: parar.signal });
    } catch {
      if (!parar.signal.aborted) {
        console.error("[trabalhos-ia] Comunicação ou contrato indisponível. Nova tentativa com espera.");
        await esperar(Math.min(60_000, 5_000 * 2 ** Math.min(falhas++, 4)), undefined, { signal: parar.signal }).catch(() => {});
      }
    }
  }
}
main().catch(() => { console.error("[trabalhos-ia] Revise configuração, login e versão do Codex na VM."); process.exitCode = 1; });
