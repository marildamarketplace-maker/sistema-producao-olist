import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { NextRequest } from "next/server";
import { assinarContextoOlist, COOKIE_CONTEXTO_OLIST, verificarContextoOlist } from "../src/lib/olist-oauth-contexto";

test("OAuth falha sem persistir credenciais quando contexto ou provedor são inválidos", async t => {
  process.env.OLIST_OAUTH_STATE_SECRET = "segredo-ficticio-oauth-exclusivo-desta-suite-32";
  let chamadas = 0;
  let gravacoes = 0;
  let autorizado = true;
  let clientSecret = "credencial-ficticia";
  let status = 200;
  let dados: unknown = {};
  let falhar = false;
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => autorizado ? { id: "usuario-a" } : null },
    aplicativo: { findUnique: async () => ({ id: "app-a", nome: "Aplicativo fictício", olistClientId: "client-ficticio", olistClientSecret: clientSecret }) },
    integracaoOlistToken: { upsert: async () => { gravacoes++; return { id: "token-ficticio" }; } },
  } });
  t.mock.method(axios, "post", async () => {
    chamadas++;
    if (falhar) throw new Error("access_token=nao-expor-token refresh_token=nao-expor-refresh");
    return { status, data: dados };
  });
  const { GET } = await import("../src/app/api/olist/callback/route");
  const requisicao = (opcoes: { cookie?: string; code?: string; state?: string } = {}) => {
    const cookie = opcoes.cookie ?? assinarContextoOlist("app-a", "usuario-a");
    const state = opcoes.state ?? verificarContextoOlist(cookie)?.state ?? "expirado";
    const parametros = new URLSearchParams({ code: opcoes.code ?? "codigo-ficticio", state });
    return new NextRequest(`https://erp.example.test/api/olist/callback?${parametros}`, {
      headers: { cookie: `${COOKIE_CONTEXTO_OLIST}=${cookie}` },
    });
  };
  const reset = () => { chamadas = 0; gravacoes = 0; autorizado = true; clientSecret = "credencial-ficticia"; status = 200; dados = {}; falhar = false; };

  await t.test("contexto expirado impede consulta ao provedor", async () => {
    reset();
    const cookie = assinarContextoOlist("app-a", "usuario-a", Date.now() - 601_000);
    assert.equal((await GET(requisicao({ cookie }))).status, 400);
    assert.equal(chamadas, 0); assert.equal(gravacoes, 0);
  });
  await t.test("código excedendo o limite é recusado antes do OAuth", async () => {
    reset();
    assert.equal((await GET(requisicao({ code: "x".repeat(4097) }))).status, 400);
    assert.equal(chamadas, 0); assert.equal(gravacoes, 0);
  });
  await t.test("permissão revogada não permite finalizar contexto ainda válido", async () => {
    reset(); autorizado = false;
    assert.equal((await GET(requisicao())).status, 403);
    assert.equal(chamadas, 0); assert.equal(gravacoes, 0);
  });
  await t.test("configuração sem segredo não chama o provedor", async () => {
    reset(); clientSecret = "";
    assert.equal((await GET(requisicao())).status, 409);
    assert.equal(chamadas, 0); assert.equal(gravacoes, 0);
  });
  await t.test("resposta 200 incompleta nunca substitui tokens existentes", async () => {
    for (const resposta of [{}, { access_token: "token-ficticio", expires_in: 3600 }, { access_token: "token-ficticio", refresh_token: "refresh-ficticio", expires_in: -1 }, "<html>erro</html>"]) {
      reset(); dados = resposta;
      assert.equal((await GET(requisicao())).status, 502);
      assert.equal(chamadas, 1); assert.equal(gravacoes, 0);
    }
  });
  await t.test("rejeição do provedor não retorna seu corpo sensível", async () => {
    reset(); status = 401; dados = { error: "nao-expor-token" };
    const resposta = await GET(requisicao());
    assert.equal(resposta.status, 502);
    assert.equal((await resposta.text()).includes("nao-expor-token"), false);
    assert.equal(gravacoes, 0);
  });
  await t.test("timeout do provedor é sanitizado e não persiste estado parcial", async () => {
    reset(); falhar = true;
    const resposta = await GET(requisicao());
    assert.equal(resposta.status, 502);
    const texto = await resposta.text();
    assert.equal(texto.includes("nao-expor"), false);
    assert.equal(texto.includes("access_token"), false);
    assert.equal(gravacoes, 0);
  });
});
