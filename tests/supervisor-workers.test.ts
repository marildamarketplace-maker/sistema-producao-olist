import assert from "node:assert/strict";
import test from "node:test";
import { ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { iniciarWorkers } from "../src/lib/automatizacao/supervisor-workers";

function fixture() {
  const parar = new AbortController();
  const filhos: { arquivo: string; processo: ChildProcess; sinais: unknown[] }[] = [];
  const logs: string[] = [];
  const criarProcesso = (arquivo: string) => {
    const processo = new ChildProcess(), sinais: unknown[] = [];
    processo.kill = sinal => { sinais.push(sinal); queueMicrotask(() => processo.emit("close", 0)); return true; };
    filhos.push({ arquivo, processo, sinais });
    queueMicrotask(() => processo.emit("spawn"));
    return processo;
  };
  return { parar, filhos, logs, opcoes: { signal: parar.signal, criarProcesso, informar: (linha: string) => logs.push(linha) } };
}

test("sem credencial IA, o iniciador mantém somente as rotinas", async () => {
  const f = fixture(); const encerrado = iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test" } });
  assert.deepEqual(f.filhos.map(x => x.arquivo), ["scripts/automatizacao-worker.ts"]);
  assert.match(f.logs[0], /IA desativada/);
  f.parar.abort(); assert.equal(await encerrado, 0); assert.deepEqual(f.filhos[0].sinais, ["SIGTERM"]);
});

test("credencial IA habilita os dois processos e Ctrl+C encerra ambos", async () => {
  const f = fixture(); const encerrado = iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test", TRABALHOS_IA_WORKER_TOKEN: "segredo-nao-logar" } });
  assert.deepEqual(f.filhos.map(x => x.arquivo), ["scripts/automatizacao-worker.ts", "scripts/trabalhos-ia-worker.ts"]);
  f.parar.abort(); assert.equal(await encerrado, 0);
  assert.ok(f.filhos.every(x => x.sinais.join() === "SIGTERM")); assert.ok(!f.logs.join().includes("segredo-nao-logar"));
});

test("falha de um worker é identificada sem reiniciar ou interromper o outro", async () => {
  const f = fixture(); const encerrado = iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test", TRABALHOS_IA_WORKER_TOKEN: "token" } });
  f.filhos[1].processo.emit("error", new Error("mensagem contendo segredo"));
  f.filhos[1].processo.emit("close", 1);
  assert.match(f.logs.join(), /Trabalhos IA: processo interrompido.*demais workers continuam/);
  assert.equal(f.filhos.length, 2); assert.deepEqual(f.filhos[0].sinais, []);
  assert.ok(!f.logs.join().includes("contendo segredo"));
  f.filhos[0].processo.emit("close", 1); assert.equal(await encerrado, 1);
});

test("encerramento força saída após prazo e não inicia se já foi cancelado", async () => {
  const f = fixture(); const encerrado = iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test" }, prazoEncerramentoMs: 5 });
  f.filhos[0].processo.kill = sinal => { f.filhos[0].sinais.push(sinal); if (sinal === "SIGKILL") queueMicrotask(() => f.filhos[0].processo.emit("close", null)); return true; };
  f.parar.abort(); assert.equal(await encerrado, 0); assert.deepEqual(f.filhos[0].sinais, ["SIGTERM", "SIGKILL"]);
  assert.equal(await iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test" } }), 0); assert.equal(f.filhos.length, 1);
});

test("falha ao criar um processo preserva o consumidor que iniciou", async () => {
  const f = fixture(); let criacoes = 0;
  const encerrado = iniciarWorkers({ ...f.opcoes, env: { NODE_ENV: "test", TRABALHOS_IA_WORKER_TOKEN: "token" }, criarProcesso: (arquivo, env) => {
    if (++criacoes === 2) throw new Error("segredo");
    assert.equal(env.TRABALHOS_IA_WORKER_TOKEN, "token"); return f.opcoes.criarProcesso(arquivo);
  } });
  assert.equal(f.filhos.length, 1); assert.deepEqual(f.filhos[0].sinais, []);
  assert.match(f.logs.join(), /Trabalhos IA: falha ao criar/); assert.ok(!f.logs.join().includes("segredo"));
  f.parar.abort(); await encerrado;
});

test("supervisor sinaliza e aguarda dois subprocessos reais", { timeout: 10_000 }, async t => {
  const parar = new AbortController(), filhos: ChildProcess[] = [], prontos: Promise<unknown>[] = [];
  const encerrado = iniciarWorkers({ signal: parar.signal, env: { NODE_ENV: "test", TRABALHOS_IA_WORKER_TOKEN: "ficticio" }, informar: () => {}, criarProcesso: () => {
    const filho = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>process.exit(0)); console.log("pronto"); setInterval(()=>{},1000)'], {
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "ignore"],
    });
    filhos.push(filho); prontos.push(once(filho.stdout!, "data")); return filho;
  } });
  t.after(() => { parar.abort(); for (const filho of filhos) if (filho.exitCode === null && filho.signalCode === null) filho.kill("SIGKILL"); });
  await Promise.all(prontos); parar.abort(); assert.equal(await encerrado, 0);
  assert.equal(filhos.length, 2); assert.ok(filhos.every(filho => filho.exitCode === 0));
});
