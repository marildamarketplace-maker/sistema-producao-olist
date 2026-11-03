import test from "node:test";
import assert from "node:assert/strict";
import { solicitarReconexaoOlist } from "../src/lib/reconectar-olist";

const sessao = (token: string | null, error: unknown = null) => ({
  data: { session: token ? { access_token: token } : null }, error,
});

test("reconexão renova sessão rejeitada e envia o novo token uma única vez", async () => {
  const tokens: string[] = [];
  let renovacoes = 0;
  const url = await solicitarReconexaoOlist({
    getSession: async () => sessao("antigo"),
    refreshSession: async () => { renovacoes++; return sessao("novo"); },
  }, async (token) => {
    tokens.push(token);
    return token === "antigo"
      ? { status: 401, data: { error: "Token de autenticação inválido." } }
      : { status: 200, data: { login_url: "/api/olist/login" } };
  });
  assert.equal(url, "/api/olist/login");
  assert.deepEqual(tokens, ["antigo", "novo"]);
  assert.equal(renovacoes, 1);
});

test("sucesso, falta de permissão e erro do servidor não renovam sessão", async () => {
  for (const status of [200, 403, 500]) {
    let chamadas = 0;
    const resultado = solicitarReconexaoOlist({
      getSession: async () => sessao("valido"),
      refreshSession: async () => { assert.fail("não deve renovar"); },
    }, async () => { chamadas++; return { status, data: { error: "Falha esperada" } }; });
    if (status === 200) assert.equal(await resultado, "/api/olist/login");
    else await assert.rejects(resultado, /Falha esperada/);
    assert.equal(chamadas, 1);
  }
});

test("sessão ausente ou erro ao ler sessão não envia requisição", async () => {
  for (const atual of [sessao(null), sessao("token", new Error("falha"))]) {
    await assert.rejects(solicitarReconexaoOlist({
      getSession: async () => atual,
      refreshSession: async () => { assert.fail("não deve renovar"); },
    }, async () => { assert.fail("não deve enviar"); }), /sessão do sistema.*Entre novamente/);
  }
});

test("renovação inválida e segunda rejeição exigem login sem loop", async () => {
  for (const renovada of [sessao(null), sessao("novo", new Error("revogada")), sessao("novo")]) {
    let chamadas = 0;
    let renovacoes = 0;
    await assert.rejects(solicitarReconexaoOlist({
      getSession: async () => sessao("antigo"),
      refreshSession: async () => { renovacoes++; return renovada; },
    }, async () => { chamadas++; return { status: 401, data: {} }; }), /sessão do sistema.*Entre novamente/);
    assert.equal(renovacoes, 1);
    assert.equal(chamadas, renovada.error || !renovada.data.session ? 1 : 2);
  }
});

test("falha de rede propaga sem repetir a operação", async () => {
  const falha = new Error("offline");
  await assert.rejects(solicitarReconexaoOlist({
    getSession: async () => sessao("valido"),
    refreshSession: async () => { assert.fail("não deve renovar"); },
  }, async () => { throw falha; }), (error) => error === falha);
});
