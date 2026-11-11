import assert from "node:assert/strict";
import test from "node:test";
import { buscarVariantesEstampa } from "../src/services/buscarVariantesEstampa";

const entrada = { codigo: "MV123", variante: "", pagina: 2, token: "token-teste", signal: new AbortController().signal };

test("busca todas as variantes por código base exato, com autorização e paginação", async () => {
  const dados = { estampas: [], total: 25, totalPaginas: 2, pagina: 2 };
  const resultado = await buscarVariantesEstampa(entrada, async (url, opcoes) => {
    const params = new URL(String(url), "https://example.test").searchParams;
    assert.deepEqual(Object.fromEntries(params), { codigo: "MV123", pagina: "2", porPagina: "24", ordenacao: "CODIGO_ASC" });
    assert.deepEqual(opcoes?.headers, { Authorization: "Bearer token-teste" });
    assert.equal(opcoes?.signal, entrada.signal);
    assert.equal(opcoes?.cache, "no-store");
    return Response.json(dados);
  });
  assert.deepEqual(resultado, dados);
});

test("filtro de variante preserva o código base e codifica caracteres especiais", async () => {
  await buscarVariantesEstampa({ ...entrada, codigo: "MV 123&", variante: " A+1 " }, async (url) => {
    const params = new URL(String(url), "https://example.test").searchParams;
    assert.equal(params.get("codigo"), "MV 123&");
    assert.equal(params.get("variante"), "A+1");
    return Response.json({ estampas: [] });
  });
});

test("propaga falhas e cancelamento para permitir feedback e retry no modal", async () => {
  await assert.rejects(buscarVariantesEstampa(entrada, async () => Response.json({ error: "Sem permissão" }, { status: 403 })), /Sem permissão/);
  await assert.rejects(buscarVariantesEstampa(entrada, async () => Response.json({}, { status: 500 })), /Não foi possível buscar as variantes/);
  await assert.rejects(buscarVariantesEstampa(entrada, async () => { throw new DOMException("Cancelado", "AbortError"); }), { name: "AbortError" });
});
