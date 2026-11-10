import assert from "node:assert/strict";
import { test } from "node:test";
import { ambienteWorkerCodex } from "@/lib/automatizacao/ambiente-worker-codex";

test("preserva sessão persistida sem transmitir credenciais de API ou ERP", () => {
  const env = ambienteWorkerCodex({
    NODE_ENV: "test", HOME: "/home/operador", PATH: "/usr/bin", CODEX_HOME: "/home/operador/.codex",
    CODEX_API_KEY: "segredo", OPENAI_API_KEY: "segredo",
    AUTOMATIZACAO_WORKER_TOKEN: "segredo", DATABASE_URL: "segredo",
  });
  assert.deepEqual(env, {
    NODE_ENV: "production", PATH: "/usr/bin", HOME: "/home/operador",
    CODEX_HOME: "/home/operador/.codex",
  });
});

test("sem CODEX_HOME usa HOME persistente e exige usuário configurado", () => {
  assert.equal(ambienteWorkerCodex({ NODE_ENV: "test", HOME: "/home/operador" }).CODEX_HOME, undefined);
  assert.throws(() => ambienteWorkerCodex({ NODE_ENV: "test" }), /HOME_CODEX_AUSENTE/);
});
