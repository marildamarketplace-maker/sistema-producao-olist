import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { FalhaConsultaSku } from "../src/lib/anotar-sku/contrato";

test("cliente Olist da fila: contratos, limites HTTP e classificação de falhas", async t => {
  let leiturasToken = 0;
  Object.assign(globalThis, { prisma: {
    aplicativo: { findUnique: async () => ({ id: "app", nome: "Teste" }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: `token-ficticio-${++leiturasToken}`, expiresAt: new Date(Date.now() + 3_600_000) }) },
  } });
  const { clienteAnotarSku, interpretarPaginaSku, retryAfterSku } = await import("../src/lib/anotar-sku/olist");
  await t.test("listagem inválida não é interpretada como resultado vazio", () => {
    for (const payload of [{}, "<html>indisponível</html>", { itens: [{ id: "inválido" }] }, { itens: [{ id: Number.MAX_SAFE_INTEGER + 1 }] }, Array(101).fill({ id: 1 })]) {
      assert.throws(() => interpretarPaginaSku(payload), FalhaConsultaSku);
    }
    assert.deepEqual(interpretarPaginaSku({ itens: [] }), []);
    assert.deepEqual(interpretarPaginaSku({ itens: [{ id: 42 }, { id: "43" }] }), ["42", "43"]);
    assert.equal(retryAfterSku("120"), 120_000);
    assert.equal(retryAfterSku("Mon, 16 Nov 2026 20:01:00 GMT", Date.parse("2026-11-16T20:00:00Z")), 60_000);
    assert.equal(retryAfterSku("inválido"), 0);
  });
  await t.test("envia paginação e timeout; 401 tenta outro token apenas uma vez", async s => {
    const chamadas: string[] = [];
    s.mock.method(axios, "get", async (url: string, config: { timeout: number; signal: AbortSignal; headers: { Authorization: string } }) => {
      const endereco = new URL(url);
      assert.equal(endereco.searchParams.get("offset"), "200");
      assert.equal(endereco.searchParams.get("limit"), "100");
      assert.equal(endereco.searchParams.get("situacao"), "3");
      assert.equal(config.timeout, 20_000); assert.ok(config.signal instanceof AbortSignal);
      chamadas.push(config.headers.Authorization);
      return { status: 401, headers: {}, data: { segredo: "não expor" } };
    });
    await assert.rejects(clienteAnotarSku.listar("app", "3", 200), (erro: unknown) => erro instanceof FalhaConsultaSku && erro.codigo === "OLIST_401" && !erro.temporaria && !erro.message.includes("não expor"));
    assert.equal(chamadas.length, 2); assert.notEqual(chamadas[0], chamadas[1]);
  });
  await t.test("429/5xx não repetem HTTP dentro da mesma etapa e respeitam Retry-After", async s => {
    for (const status of [408, 429, 500, 503, 403, 404]) {
      let consultas = 0;
      const mock = s.mock.method(axios, "get", async () => { consultas++; return { status, headers: { "retry-after": "180" }, data: {} }; });
      await assert.rejects(clienteAnotarSku.detalhar("app", "42"), (erro: unknown) => erro instanceof FalhaConsultaSku && erro.temporaria === [408, 429, 500, 503].includes(status) && erro.retryAfterMs === 180_000);
      assert.equal(consultas, 1); mock.mock.restore();
    }
  });
  await t.test("detalhe exige array de itens e agrega quantidades por SKU", async s => {
    let data: unknown = {};
    s.mock.method(axios, "get", async () => ({ status: 200, headers: {}, data }));
    await assert.rejects(clienteAnotarSku.detalhar("app", "42"), FalhaConsultaSku);
    data = { itens: [{ produto: { sku: "A", descricao: "Produto da Olist" }, quantidade: 2 }, { produto: { sku: "A" }, quantidade: 3 }] };
    assert.deepEqual(await clienteAnotarSku.detalhar("app", "42"), [{ sku: "A", quantidade: 5, tituloProduto: "Produto da Olist" }]);
  });
});
