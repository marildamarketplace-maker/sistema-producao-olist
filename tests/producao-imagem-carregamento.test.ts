import assert from "node:assert/strict";
import test from "node:test";
import { criarCarregadorImagens } from "../src/lib/producao-imagem-carregamento";

test("deduplica por recurso e credencial, limita concorrência e permite retry manual", async () => {
  let ativos = 0, maximo = 0, chamadas = 0;
  const liberar: Array<() => void> = [];
  const carregar = criarCarregadorImagens(async () => {
    chamadas++; ativos++; maximo = Math.max(maximo, ativos);
    await new Promise<void>((resolve) => liberar.push(resolve));
    ativos--;
    return Response.json({ imagemUrl: "https://example.test/a.jpg" });
  }, 2);
  const a = carregar("/a", "token-a");
  assert.equal(a, carregar("/a", "token-a"));
  const b = carregar("/a", "token-b");
  const c = carregar("/b", "token-a");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chamadas, 2);
  liberar.shift()!(); liberar.shift()!();
  await Promise.all([a, b]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chamadas, 3); liberar.shift()!();
  await c;
  assert.equal(maximo, 2);
  assert.equal(await carregar("/a", "token-a"), "https://example.test/a.jpg");
  assert.equal(chamadas, 3);

  let tentativas = 0;
  const retry = criarCarregadorImagens(async (url, options) => {
    tentativas++;
    assert.equal(String(url), "/a");
    assert.deepEqual(JSON.parse(String(options?.body)), { imagemInvalida: "https://example.test/antiga.jpg" });
    assert.equal(options?.method, "POST");
    return tentativas === 1 ? Response.json({ error: "Falhou" }, { status: 429 }) : Response.json({ imagemUrl: "https://example.test/nova.jpg" });
  });
  await assert.rejects(retry("/a", "token", "https://example.test/antiga.jpg"), /Falhou/);
  await assert.rejects(retry("/a", "token", "https://example.test/antiga.jpg"), /Falhou/);
  assert.equal(tentativas, 1);
  assert.equal(await retry("/a", "token", "https://example.test/antiga.jpg", true), "https://example.test/nova.jpg");
  assert.equal(tentativas, 2);
});

test("rejeita ausência de imagem e URLs não seguras", async () => {
  for (const imagemUrl of [null, "javascript:alert(1)", "https://user:senha@example.test/a.jpg"]) {
    const carregar = criarCarregadorImagens(async () => Response.json({ imagemUrl }));
    await assert.rejects(carregar("/a", "token"));
  }
});
