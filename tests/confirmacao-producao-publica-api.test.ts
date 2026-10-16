import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { criarTokenPublicoConfirmacaoProducao } from "../src/lib/confirmacao-entrega-producao-publica";

const app = "00000000-0000-0000-0000-000000000001";
const pedido = "00000000-0000-0000-0000-000000000002";

test("link público exige foto, senha e vínculo com a solicitação antes de upload", async (t) => {
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = "segredo-exclusivo-de-teste-com-mais-de-32-caracteres";
  let consultasPedido = 0;
  Object.assign(globalThis, { prisma: {
    aplicativo: { findUnique: async () => ({ id: app, jobs: "CONFIRMACAO_ENTREGA_PRODUCAO" }) },
    solicitacaoProducao: { findFirst: async () => { consultasPedido++; return null; } },
  } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Não deve fazer upload"); });
  const { POST } = await import("../src/app/api/public/confirmacao-entrega-producao/route");
  const token = criarTokenPublicoConfirmacaoProducao({ aplicativoId: app, solicitacaoId: pedido });
  const chamar = (foto: boolean, senha = "marilda", solicitacaoId = pedido, bearer = token) => {
    const form = new FormData();
    form.set("solicitacaoId", solicitacaoId); form.set("senha", senha);
    form.set("itens", JSON.stringify([{ id: "item", quantidadeProduzida: 1 }]));
    if (foto) form.set("foto", new File(["foto"], "foto.jpg", { type: "image/jpeg" }));
    return POST(new NextRequest("https://example.test", { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: form }));
  };
  assert.equal((await chamar(true, "marilda", pedido, "invalido")).status, 401);
  assert.equal((await chamar(false)).status, 400);
  assert.equal((await chamar(true, "invalida")).status, 401);
  assert.equal((await chamar(true, "marilda", "outro-pedido")).status, 403);
  assert.equal(consultasPedido, 0);
  assert.equal((await chamar(true)).status, 400);
  assert.equal(consultasPedido, 1);
});
