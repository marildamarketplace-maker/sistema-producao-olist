import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Session } from "@supabase/supabase-js";

function sessao(id: string): Session {
  return {
    access_token: `token-${id}`, refresh_token: `refresh-${id}`, token_type: "bearer",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "mesmo-usuario", email: "teste@example.test", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" },
  };
}

function cliente(id: string, fetch: typeof globalThis.fetch) {
  const dados = new Map([[`sessao-${id}`, JSON.stringify(sessao(id))]]);
  return createClient("https://auth.example.test", "chave-ficticia", {
    global: { fetch },
    auth: {
      storageKey: `sessao-${id}`, autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: key => dados.get(key) ?? null,
        setItem: (key, value) => { dados.set(key, value); },
        removeItem: key => { dados.delete(key); },
      },
    },
  });
}

test("SDK instalado envia escopo local e outra sessão consegue renovar depois da saída", async () => {
  const ativas = new Set(["pc", "vm"]);
  let chamadas = 0;
  const transporte: typeof fetch = async (input, init) => {
    chamadas++;
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/logout") {
      assert.equal(url.searchParams.get("scope"), "local");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token-pc");
      ativas.delete("pc");
      return new Response(null, { status: 204 });
    }
    assert.equal(url.pathname, "/auth/v1/token");
    assert.equal(url.searchParams.get("grant_type"), "refresh_token");
    assert.equal(JSON.parse(String(init?.body)).refresh_token, "refresh-vm");
    assert.ok(ativas.has("vm"));
    return Response.json({ ...sessao("vm-renovada"), user: sessao("vm").user });
  };
  const pc = cliente("pc", transporte);
  const vm = cliente("vm", transporte);
  assert.equal((await pc.auth.signOut({ scope: "local" })).error, null);
  assert.equal((await pc.auth.getSession()).data.session, null);
  const renovada = await vm.auth.refreshSession();
  assert.equal(renovada.error, null);
  assert.equal(renovada.data.session?.access_token, "token-vm-renovada");
  assert.equal((await vm.auth.getSession()).data.session?.access_token, "token-vm-renovada");
  assert.equal(chamadas, 2, "Uma saída e uma renovação, sem polling nem rede real");
});

test("SDK instalado preserva sessão em erro do serviço e limpa sessão já revogada", async () => {
  for (const status of [500, 401]) {
    const eventos: string[] = [];
    const pc = cliente(`pc-${status}`, async () => Response.json({ message: "Falha simulada" }, { status }));
    const { data } = pc.auth.onAuthStateChange(event => { eventos.push(event); });
    const resultado = await pc.auth.signOut({ scope: "local" });
    const atual = (await pc.auth.getSession()).data.session;
    assert.equal(Boolean(resultado.error), status === 500);
    assert.equal(Boolean(atual), status === 500);
    assert.equal(eventos.includes("SIGNED_OUT"), status === 401);
    data.subscription.unsubscribe();
  }
});
