import type { EstampaJob } from "@prisma/client";

export type ResultadoJobCron = "concluido" | "ignorado" | "falha" | "lock_perdido";
export type DependenciasEstampasCron = {
  detectar: (deveContinuar: () => boolean) => Promise<unknown>;
  recuperar: () => Promise<unknown>;
  assumir: () => Promise<EstampaJob | null>;
  processar: (job: EstampaJob) => Promise<ResultadoJobCron>;
  agora?: () => number;
  estaPausado: () => Promise<boolean>;
};

// O orçamento inclui detecção e recuperação. A reserva cobre preview,
// tentativas do modelo primário, fallback e persistência de cada rodada.
export async function executarEstampasCron(
  opcoes: { prazoMs: number; reservaJobMs: number; maxJobs: number; concorrencia: number },
  deps: DependenciasEstampasCron,
) {
  for (const [nome, valor] of Object.entries(opcoes)) {
    if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error(`${nome} deve ser inteiro positivo.`);
  }
  const agora = deps.agora ?? Date.now;
  const podeAssumir = () => agora() + opcoes.reservaJobMs < opcoes.prazoMs;
  const resultado = { assumidos: 0, concluidos: 0, ignorados: 0, falhas: 0, locksPerdidos: 0 };
  if (await deps.estaPausado()) {
    return { ...resultado, deteccao: null, recuperacao: null, motivoParada: "pausado" };
  }
  const recuperacao = await deps.recuperar();
  // Não deixa um catálogo grande consumir todo o tempo destinado à fila.
  const prazoDeteccao = Math.min(agora() + 20_000, opcoes.prazoMs - opcoes.reservaJobMs);
  const deteccao = await deps.detectar(() => podeAssumir() && agora() < prazoDeteccao);
  let filaVazia = false;
  let pausado = false;
  while (resultado.assumidos < opcoes.maxJobs && podeAssumir() && !filaVazia) {
    // A rodada já assumida termina; a pausa impede assumir a próxima.
    if (await deps.estaPausado()) { pausado = true; break; }
    const jobs: EstampaJob[] = [];
    let erroClaim: unknown;
    try {
      while (jobs.length < opcoes.concorrencia && resultado.assumidos < opcoes.maxJobs && podeAssumir()) {
        const job = await deps.assumir();
        if (!job) { filaVazia = true; break; }
        jobs.push(job);
        resultado.assumidos++;
      }
    } catch (error) { erroClaim = error; }
    // Mesmo se um claim falhar, finaliza os jobs já reservados antes de propagar.
    const processados = await Promise.allSettled(jobs.map(deps.processar));
    for (const item of processados) {
      if (item.status === "rejected") continue;
      if (item.value === "concluido") resultado.concluidos++;
      else if (item.value === "ignorado") resultado.ignorados++;
      else if (item.value === "lock_perdido") resultado.locksPerdidos++;
      else resultado.falhas++;
    }
    const rejeitado = processados.find(item => item.status === "rejected");
    if (erroClaim) throw erroClaim;
    if (rejeitado?.status === "rejected") throw rejeitado.reason;
  }
  return { ...resultado, deteccao, recuperacao, motivoParada: pausado ? "pausado" : filaVazia ? "fila_vazia" : resultado.assumidos >= opcoes.maxJobs ? "limite_jobs" : "limite_tempo" };
}
