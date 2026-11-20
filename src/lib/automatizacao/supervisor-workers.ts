import { spawn, type ChildProcess } from "node:child_process";

type Opcoes = {
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  prazoEncerramentoMs?: number;
  criarProcesso?: (arquivo: string, env: NodeJS.ProcessEnv) => ChildProcess;
  informar?: (mensagem: string) => void;
};

// Controla somente o ciclo de vida dos processos. Filas e tentativas continuam
// sob responsabilidade de cada worker, sem repetir rotinas neste iniciador.
export async function iniciarWorkers(opcoes: Opcoes): Promise<number> {
  if (opcoes.signal.aborted) return 0;
  const env = opcoes.env ?? process.env;
  const informar = opcoes.informar ?? console.info;
  const criar = opcoes.criarProcesso ?? ((arquivo, ambiente) => spawn(process.execPath, ["--import", "tsx", arquivo], {
    env: ambiente, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "inherit", "inherit"],
  }));
  const workers = [{ nome: "Rotinas", arquivo: "scripts/automatizacao-worker.ts" }];
  if (env.TRABALHOS_IA_WORKER_TOKEN?.trim()) workers.push({ nome: "Trabalhos IA", arquivo: "scripts/trabalhos-ia-worker.ts" });
  else informar("[iniciador] IA desativada: configure TRABALHOS_IA_WORKER_TOKEN no worker.env para iniciar os dois processos.");

  const ativos = new Set<ChildProcess>();
  let encerrando = false;
  let limite: ReturnType<typeof setTimeout> | undefined;
  const sinalizar = (processo: ChildProcess, signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && processo.pid) process.kill(-processo.pid, signal);
      else processo.kill(signal);
    } catch { /* O processo pode ter encerrado entre a verificação e o sinal. */ }
  };
  const parar = () => {
    if (encerrando) return;
    encerrando = true;
    informar("[iniciador] Encerrando os workers. Aguarde a liberação dos processos.");
    limite = setTimeout(() => {
      if (ativos.size) informar("[iniciador] Prazo de encerramento atingido; interrompendo os processos restantes.");
      for (const processo of ativos) sinalizar(processo, "SIGKILL");
    }, opcoes.prazoEncerramentoMs ?? 30_000);
    for (const processo of ativos) sinalizar(processo, "SIGTERM");
  };
  const conclusoes = workers.map(({ nome, arquivo }) => new Promise<number>(resolvido => {
    let processo: ChildProcess;
    try { processo = criar(arquivo, env); }
    catch {
      informar(`[iniciador] ${nome}: falha ao criar o processo. Confira a instalação e execute o iniciador novamente.`);
      resolvido(1); return;
    }
    ativos.add(processo);
    processo.once("spawn", () => informar(`[iniciador] ${nome}: processo iniciado. A conexão será conferida pelo próprio worker.`));
    let terminou = false;
    const finalizar = () => {
      if (terminou) return;
      terminou = true; ativos.delete(processo);
      if (!encerrando) informar(`[iniciador] ${nome}: processo interrompido. ${ativos.size ? "Os demais workers continuam." : "Nenhum worker continua ativo."} Confira o erro acima e reinicie pelo iniciar-worker.sh.`);
      resolvido(encerrando ? 0 : 1);
    };
    processo.once("error", finalizar);
    processo.once("close", finalizar);
  }));
  opcoes.signal.addEventListener("abort", parar, { once: true });
  if (opcoes.signal.aborted) parar();
  try {
    const resultados = await Promise.all(conclusoes);
    return encerrando ? 0 : Math.max(...resultados);
  } finally {
    clearTimeout(limite);
    opcoes.signal.removeEventListener("abort", parar);
  }
}
