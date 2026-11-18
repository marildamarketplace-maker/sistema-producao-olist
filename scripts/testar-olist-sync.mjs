import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const modos = new Set(["--unit", "--database", "--all"]);
const argumentos = process.argv.slice(2);
const modo = argumentos[0] ?? "--unit";
if (argumentos.length > 1 || !modos.has(modo)) {
  console.error("Uso: node scripts/testar-olist-sync.mjs [--unit|--database|--all]");
  process.exitCode = 2;
} else {
  const variaveis = ["OLIST_SYNC_TEST_DATABASE_URL", "OLIST_SYNC_API_TEST_DATABASE_URL", "OLIST_SYNC_SERVICE_TEST_DATABASE_URL", "OLIST_SYNC_CONCURRENCY_TEST_DATABASE_URL", "OLIST_SYNC_INCREMENTAL_TEST_DATABASE_URL"];
  let valido = true;
  if (modo !== "--unit") {
    const destinos = new Set();
    for (const chave of variaveis) {
      try {
        const url = new URL(process.env[chave] ?? "");
        if (!["postgresql:", "postgres:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) ||
          !/^\/olist_sync_test[a-z0-9_]*$/.test(url.pathname) || url.search) throw new Error("Destino inválido");
        const destino = `${url.hostname}:${url.port || "5432"}${url.pathname}`.replace(/^localhost:/, "127.0.0.1:");
        if (destinos.has(destino)) throw new Error("Banco compartilhado");
        destinos.add(destino);
      } catch {
        console.error(`${chave}: configure um banco local vazio e exclusivo com prefixo olist_sync_test, sem parâmetros adicionais na URL.`);
        valido = false;
      }
    }
  }
  if (!valido) {
    process.exitCode = 2;
  } else {
    const arquivos = (await readdir(new URL("../tests/", import.meta.url)))
      .filter(nome => /^olist-(sync-.+|auth-.+|oauth-.+|reconnect-api)\.test\.ts$/.test(nome))
      .filter(nome => modo === "--all" || nome.endsWith("-database.test.ts") === (modo === "--database"))
      .sort().map(nome => `tests/${nome}`);
    if (!arquivos.length) throw new Error("Nenhum teste da sincronização encontrado.");
    // Fixtures PostgreSQL também criam roles no cluster: serializar evita corrida
    // entre bancos distintos e mantém o consumo local previsível.
    const concorrencia = modo === "--unit" ? [] : ["--test-concurrency=1"];
    const filho = spawn(process.execPath, ["--import", "tsx", "--test", ...concorrencia, ...arquivos], { cwd: raiz, stdio: "inherit", env: process.env });
    filho.on("error", () => { console.error("Não foi possível iniciar os testes."); process.exitCode = 1; });
    filho.on("exit", (codigo) => { process.exitCode = codigo ?? 1; });
  }
}
