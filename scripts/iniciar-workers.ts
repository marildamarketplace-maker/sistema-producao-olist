import { iniciarWorkers } from "@/lib/automatizacao/supervisor-workers";

const parar = new AbortController();
const encerrar = () => parar.abort();
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sinal, encerrar);
iniciarWorkers({ signal: parar.signal }).then(codigo => { process.exitCode = codigo; }).catch(() => {
  console.error("[iniciador] Não foi possível iniciar os workers. Confira a instalação.");
  process.exitCode = 1;
});
