import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("../scripts/testar-olist-sync.mjs", import.meta.url));
const variaveis = ["OLIST_SYNC_TEST_DATABASE_URL", "OLIST_SYNC_API_TEST_DATABASE_URL", "OLIST_SYNC_SERVICE_TEST_DATABASE_URL", "OLIST_SYNC_CONCURRENCY_TEST_DATABASE_URL"];
const ambiente = () => {
  const env = { ...process.env };
  for (const variavel of variaveis) delete env[variavel];
  return env;
};
const executar = (args: string[], env = ambiente()) => spawnSync(process.execPath, [runner, ...args], { env, encoding: "utf8", timeout: 5000 });

test("runner exige seleção de modo válida antes de iniciar testes", () => {
  for (const args of [["--producao"], ["--all", "--unit"]]) {
    const resultado = executar(args);
    assert.equal(resultado.status, 2);
    assert.match(resultado.stderr, /Uso:/);
    assert.equal(resultado.stdout, "");
  }
});

test("runner de banco não apresenta sucesso quando a configuração está ausente", () => {
  const resultado = executar(["--database"]);
  assert.equal(resultado.status, 2);
  for (const chave of variaveis) assert.ok(resultado.stderr.includes(chave));
  assert.equal(resultado.stdout, "");
});

test("runner recusa banco externo e nunca imprime a URL ou sua senha", () => {
  const env = ambiente();
  for (const chave of variaveis) env[chave] = "postgresql://teste:senha-ficticia-nao-expor@producao.example.test/olist_sync_test";
  const resultado = executar(["--database"], env);
  assert.equal(resultado.status, 2);
  assert.equal(resultado.stdout, "");
  assert.equal(resultado.stderr.includes("senha-ficticia-nao-expor"), false);
  assert.equal(resultado.stderr.includes("producao.example.test"), false);
});

test("runner recusa alias do mesmo banco e parâmetros capazes de trocar o host", () => {
  for (const consulta of [false, true]) {
    const env = ambiente();
    for (const [indice, chave] of variaveis.entries()) {
      env[chave] = consulta
        ? `postgresql://teste@127.0.0.1/olist_sync_test_${indice}?host=producao.example.test`
        : `postgresql://teste@${indice % 2 ? "localhost" : "127.0.0.1"}:5432/olist_sync_test`;
    }
    const resultado = executar(["--database"], env);
    assert.equal(resultado.status, 2);
    assert.equal(resultado.stdout, "");
  }
});
