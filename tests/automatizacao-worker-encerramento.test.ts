import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

test("SIGTERM aborta o executor e confirma falha terminal da rotina antes de sair", { timeout: 15_000 }, async t => {
  const pasta = await mkdtemp(join(tmpdir(), "worker-encerramento-"));
  t.after(() => rm(pasta, { recursive: true, force: true }));
  const arquivo = join(pasta, "worker.cjs");
  await build({
    entryPoints: [join(process.cwd(), "scripts/automatizacao-worker.ts")], outfile: arquivo,
    bundle: true, platform: "node", format: "cjs", tsconfig: join(process.cwd(), "tsconfig.json"),
    plugins: [{ name: "dependencias-locais", setup(builder) {
      builder.onResolve({ filter: /^@\/services\/image-analysis\/executarCodexCli$/ }, () => ({ path: "codex", namespace: "teste" }));
      builder.onResolve({ filter: /^@\/lib\/automatizacao\/cliente-fila-worker$/ }, () => ({ path: "fila", namespace: "teste" }));
      builder.onResolve({ filter: /^@\/lib\/automatizacao\/browser-worker$/ }, () => ({ path: "browser", namespace: "teste" }));
      builder.onResolve({ filter: /^@\/lib\/automatizacao\/evidencia-worker$/ }, () => ({ path: "evidencia", namespace: "teste" }));
      builder.onLoad({ filter: /.*/, namespace: "teste" }, args => ({ loader: "js", contents: args.path === "codex" ? `
        export const ambienteCodexCli = e => e;
        export async function executarCodexCli(options) {
          if (options.args[0] === "--version") return {stdout:"codex-cli TESTE",stderr:""};
          return new Promise((resolve,reject) => {
            const abortar=()=>{console.info("TESTE_EXECUTOR_ABORTADO");reject(new Error("abortado"));};
            options.signal.addEventListener("abort",abortar,{once:true});
            if(options.signal.aborted) abortar();
            console.info("TESTE_EXECUTOR_PRONTO");
          });
        }` : args.path === "fila" ? `
        export class ErroComunicacaoFila extends Error {}
        export function criarClienteFilaWorker() { return async corpo => {
          if(corpo.acao === "reservar") return {trabalho:{reserva:"11111111-1111-4111-8111-111111111111", markdown:"Teste",rotinaNome:"Rotina simulada"}};
          if(corpo.acao === "finalizar") console.info("TESTE_FINALIZAR " + JSON.stringify(corpo));
          return true;
        }; }` : args.path === "evidencia" ? `
        export const carregarEvidenciaWorker = async () => undefined;
        export const motivoEvidenciaIndisponivel = () => "teste";
        ` : `
        export const configurarBrowserWorker = () => null;
        export const promptBrowserWorker = texto => texto;
        export const respostaBrowserSchema = {parse:r=>r};
        ` }));
    } }],
  });
  const filho = spawn(process.execPath, [arquivo], { stdio: ["ignore", "pipe", "pipe"], env: {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
    AUTOMATIZACAO_ERP_URL: "https://erp.example.test", AUTOMATIZACAO_WORKER_TOKEN: "credencial-ficticia", AUTOMATIZACAO_CODEX_VERSION: "TESTE",
  } });
  const encerrado = new Promise<number | null>((resolve, reject) => { filho.once("close", resolve); filho.once("error", reject); });
  t.after(() => { if (filho.exitCode === null && filho.signalCode === null) filho.kill("SIGKILL"); });
  let saida = "", erro = "", enviado = false;
  filho.stderr.on("data", chunk => { erro += String(chunk); });
  filho.stdout.on("data", chunk => {
    saida += String(chunk);
    if (!enviado && saida.includes("TESTE_EXECUTOR_PRONTO")) { enviado = true; filho.kill("SIGTERM"); }
  });
  assert.equal(await encerrado, 0, erro);
  assert.equal(enviado, true); assert.match(saida, /TESTE_EXECUTOR_ABORTADO/);
  const linha = saida.split("\n").find(l => l.startsWith("TESTE_FINALIZAR ")); assert.ok(linha);
  const fechamento = JSON.parse(linha.slice("TESTE_FINALIZAR ".length));
  assert.equal(fechamento.desfecho, "FALHA"); assert.match(fechamento.resultado, /encerrar o worker/);
  assert.ok(!saida.includes("credencial-ficticia"));
});
