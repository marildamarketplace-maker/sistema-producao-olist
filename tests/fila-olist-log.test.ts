import test from "node:test";
import assert from "node:assert/strict";

test("falha de token registra diagnóstico seguro e preserva resposta pública", async (t) => {
  let falha: unknown;
  Object.assign(globalThis, { prisma: {
    aplicativo: { findUnique: async () => ({ olistClientId: "segredo-client", olistClientSecret: "segredo-secret" }) },
    integracaoOlistToken: { findUnique: async () => { throw falha; } },
  } });
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const { consultarCadastrosFilaOlist } = await import("../src/lib/fila-olist-cadastros");
  const casos = [
    { erro: new Error("Falha no OAuth Olist/Tiny."), causa: "refresh_token_ausente", codigo: null },
    { erro: Object.assign(new Error("segredo-token"), { code: "P2028" }), causa: "falha_banco", codigo: "P2028" },
    { erro: Object.assign(new Error("segredo-token"), { code: "ETIMEDOUT" }), causa: "falha_operacional", codigo: "ETIMEDOUT" },
    { erro: Object.assign(new Error("segredo-token"), { httpStatus: 400, codigoOAuth: "invalid_grant", requerReconexao: true }), causa: "renovacao_oauth_rejeitada", codigo: null },
    { erro: Object.assign(new Error("segredo-token"), { code: "segredo-code", codigoOAuth: "segredo-oauth", config: { password: "segredo-password" } }), causa: "falha_nao_classificada", codigo: null },
  ];
  for (const caso of casos) {
    falha = caso.erro;
    await assert.rejects(consultarCadastrosFilaOlist("filial-teste", new URLSearchParams("recurso=clientes&busca=NomePrivado")), /Conecte novamente/);
    const registro = logs.at(-1)?.[1] as Record<string, unknown>;
    assert.equal(registro.filialId, "filial-teste");
    assert.equal(registro.causa, caso.causa);
    assert.equal(registro.codigo, caso.codigo);
    if (caso.causa === "renovacao_oauth_rejeitada") {
      assert.equal(registro.httpStatus, 400);
      assert.equal(registro.codigoOAuth, "invalid_grant");
      assert.equal(registro.requerReconexao, true);
    }
  }
  assert.equal(logs.length, casos.length);
  assert.doesNotMatch(JSON.stringify(logs), /segredo|NomePrivado|password|config/);
});
