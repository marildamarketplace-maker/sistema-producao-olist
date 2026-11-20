import { carregarEvidenciaWorker, motivoEvidenciaIndisponivel } from "@/lib/automatizacao/evidencia-worker";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { renovarEnquantoValida } from "@/lib/automatizacao/renovacao";
import { eventoWorker } from "@/lib/automatizacao/log-worker";
import { criarClienteFilaWorker, ErroComunicacaoFila } from "@/lib/automatizacao/cliente-fila-worker";
import { detalharFalhaExecucaoWorker } from "@/lib/automatizacao/falha-execucao-worker";
import { ambienteWorkerCodex } from "@/lib/automatizacao/ambiente-worker-codex";
import { configurarBrowserWorker, promptBrowserWorker, respostaBrowserSchema } from "@/lib/automatizacao/browser-worker";
import { z } from "zod";
import { executarCodexCli } from "@/services/image-analysis/executarCodexCli";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const respostaSchema = z.object({ resultado: z.string().trim().min(1).max(8_000).refine((texto) => !texto.includes("\0")) });
const reservaSchema = z.object({ trabalho: z.object({ reserva: z.uuid(), markdown: z.string(), rotinaNome: z.string().optional() }).nullable() });
const parar = new AbortController();
process.once("SIGTERM", () => parar.abort());
process.once("SIGINT", () => parar.abort());

async function main() {
  const destino = new URL("/api/interno/automatizacao", process.env.AUTOMATIZACAO_ERP_URL);
  const token = process.env.AUTOMATIZACAO_WORKER_TOKEN;
  const ambiente = ambienteWorkerCodex();
  const browser = configurarBrowserWorker();
  if (browser?.cli && browser.perfil) {
    await access(browser.cli);
    await mkdir(browser.perfil, { recursive: true, mode: 0o700 });
  }
  const versao = process.env.AUTOMATIZACAO_CODEX_VERSION;
  const executable = process.env.CODEX_CLI_PATH || "codex";
  if (destino.protocol !== "https:" || !token || !versao) throw new Error("CONFIGURACAO");
  const { stdout } = await executarCodexCli({ executable, args: ["--version"], cwd: tmpdir(), timeoutMs: 10_000 });
  if (stdout.trim().split(/\s+/).at(-1) !== versao) throw new Error("VERSAO_CODEX");

  const api = criarClienteFilaWorker({ destino, token, registrarFalha: (evento) => console.error(evento) });

  console.info(eventoWorker("AGUARDANDO_TAREFA"));
  while (!parar.signal.aborted) {
    try {
      const inicioReserva = performance.now();
      const { trabalho } = reservaSchema.parse(await api({ acao: "reservar" }));
      if (!trabalho) {
        await esperar(60_000, undefined, { signal: parar.signal });
        continue;
      }
      const { reserva, markdown, rotinaNome = "Rotina de automatização" } = trabalho;
      const fim = new AbortController();
      const signal = AbortSignal.any([fim.signal, parar.signal]);
      const cwd = await mkdtemp(join(tmpdir(), "erp-automatizacao-"));
      const iniciado = Date.now();
      const raizEvidencias = process.env.AUTOMATIZACAO_BROWSER_ARTIFACTS_DIR ||
        (process.env.AUTOMATIZACAO_BROWSER_PROFILE ? join(dirname(process.env.AUTOMATIZACAO_BROWSER_PROFILE), "artefatos") : undefined);
      const caminhoEvidencia = raizEvidencias ? join(raizEvidencias, `${reserva}.png`) : undefined;
      let ultimoLog = iniciado;
      let etapa: "INICIANDO_CODEX" | "EXECUTANDO" | "REGISTRANDO_RESULTADO" = "INICIANDO_CODEX";
      console.info(eventoWorker(etapa, rotinaNome, iniciado));
      const renovacao = renovarEnquantoValida({
        iniciadaEm: inicioReserva,
        renovar: async (timeoutMs) => {
          const valida = Boolean(await api({ acao: "renovar", reserva }, timeoutMs));
          if (valida && Date.now() - ultimoLog >= 30_000) {
            console.info(eventoWorker(etapa, rotinaNome, iniciado));
            ultimoLog = Date.now();
          }
          return valida;
        },
        esperar: (ms) => esperar(ms, undefined, { signal }).catch(() => {}),
        agora: () => performance.now(),
        signal,
      }).then((valida) => {
        if (!valida) {
          console.error(eventoWorker("RESERVA_PERDIDA", rotinaNome, iniciado));
          fim.abort();
        }
      });
      let desfecho = "SUCESSO";
      let resultado: string;
      let resumoWhatsapp: string | undefined;
      let evidencia: Awaited<ReturnType<typeof carregarEvidenciaWorker>> | undefined;
      try {
        const schemaPath = join(cwd, "resposta.json");
        await writeFile(schemaPath, JSON.stringify({ type: "object", properties: {
          resultado: { type: "string" }, ...(browser ? { resumoWhatsapp: { type: "string", minLength: 1, maxLength: 360 }, evidencia: { type: ["string", "null"] }, concluida: { type: "boolean" }, bloqueada: { type: "boolean" } } : {}),
        }, required: browser ? ["resultado", "concluida", "bloqueada", "evidencia", "resumoWhatsapp"] : ["resultado"], additionalProperties: false }), { mode: 0o600 });
        const saidaPath = join(cwd, "resultado.json");
        etapa = "EXECUTANDO";
        console.info(eventoWorker(etapa, rotinaNome, iniciado));
        await executarCodexCli({
          executable, cwd, timeoutMs: browser ? 900_000 : 300_000, signal,
          env: ambiente,
          args: [
            "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
            "--color", "never", "--output-schema", schemaPath, "--output-last-message", saidaPath,
            "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
            "-c", 'forced_login_method="chatgpt"',
            ...(browser?.argsCodex ?? []),
            ...["shell_tool", "unified_exec", "apps", "plugins", "memories", "multi_agent", "image_generation"]
              .flatMap((feature) => ["-c", `features.${feature}=false`]),
            "-",
          ],
          stdin: browser ? promptBrowserWorker(markdown, caminhoEvidencia) : markdown,
        });
        const resposta = JSON.parse(await readFile(saidaPath, "utf8"));
        if (browser) {
          const validada = respostaBrowserSchema.parse(resposta);
          resultado = validada.resultado;
          resumoWhatsapp = validada.resumoWhatsapp;
          const raiz = raizEvidencias;
          if (validada.evidencia && raiz) {
            try { evidencia = await carregarEvidenciaWorker(validada.evidencia, raiz, iniciado); }
            catch (error) { resultado = `${resultado.slice(0, 7750)}\nPrint de evidência indisponível: ${motivoEvidenciaIndisponivel(error)}.`; }
          } else {
            resultado = `${resultado.slice(0, 7850)}\nPrint de evidência indisponível: ${raiz ? "captura segura não fornecida" : "pasta de artefatos não configurada"}.`;
          }
          if (!validada.concluida) desfecho = validada.bloqueada ? "BLOQUEADA" : "FALHA";
        } else resultado = respostaSchema.parse(resposta).resultado;
      } catch (error) {
        if (parar.signal.aborted && !fim.signal.aborted) {
          // Uma rotina pode ter realizado ações externas antes do Ctrl+C.
          // Tente registrar falha terminal enquanto esta reserva ainda pertence
          // ao processo, sem pedir repetição automática por parada voluntária.
          desfecho = "FALHA";
          resultado = "Execução interrompida ao encerrar o worker. Confira ações parciais antes de executar novamente.";
          resumoWhatsapp = resultado;
        } else {
          const falha = detalharFalhaExecucaoWorker(error);
          const { codigo } = falha;
          desfecho = ["AUTHENTICATION_ERROR", "CONFIGURATION_ERROR"].includes(codigo) ? "INDISPONIVEL"
            : !browser && error instanceof ImageAnalysisProviderError && error.retriable ? "TEMPORARIA" : "FALHA";
          resultado = falha.resultado;
          resumoWhatsapp = falha.resumoWhatsapp;
          console.error(eventoWorker("FALHA_EXECUTOR", rotinaNome, iniciado, desfecho, falha));
        }
      } finally {
        await rm(cwd, { force: true, recursive: true }).catch(() => console.error("Falha ao limpar o diretório da execução."));
      }
      try {
        if (!fim.signal.aborted) {
          etapa = "REGISTRANDO_RESULTADO";
          console.info(eventoWorker(etapa, rotinaNome, iniciado));
          const fechamento = { acao: "finalizar", reserva, desfecho, resultado, ...(resumoWhatsapp ? { resumoWhatsapp } : {}), ...(evidencia ? { evidencia } : {}) };
          const resposta = await api(fechamento).catch(() => api(fechamento));
          if (resposta) console.info(eventoWorker("FINALIZADA", rotinaNome, iniciado, desfecho));
          else console.error(eventoWorker("RESERVA_PERDIDA", rotinaNome, iniciado));
        }
      } finally {
        fim.abort();
        await renovacao;
        console.info(eventoWorker("AGUARDANDO_TAREFA"));
      }
      if (desfecho === "INDISPONIVEL") {
        console.error("Executor Codex indisponível.");
        await esperar(60_000, undefined, { signal: parar.signal });
      }
    } catch (error) {
      if (!parar.signal.aborted) {
        if (!(error instanceof ErroComunicacaoFila)) {
          console.error(error instanceof z.ZodError
            ? "Resposta da fila fora do contrato esperado."
            : "Falha local no processamento da tarefa; dados da exceção omitidos.");
        }
        await esperar(10_000, undefined, { signal: parar.signal }).catch(() => {});
      }
    }
  }
}

main().catch(() => {
  console.error("Revise a configuração do worker e a versão instalada do Codex.");
  process.exitCode = 1;
});
