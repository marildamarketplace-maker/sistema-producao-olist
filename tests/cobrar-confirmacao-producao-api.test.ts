import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

test("cron cobra produções recentes e antigas sem filtro de data e exige autorização", async () => {
  process.env.CRON_SECRET = "cron-teste";
  process.env.APP_URL = "https://example.test";
  process.env.CONFIRMACAO_PRODUCAO_PUBLIC_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
  const aplicativoId = "00000000-0000-0000-0000-000000000001";
  let consultas = 0;
  const notificacoes: unknown[] = [];
  Object.assign(globalThis, { prisma: {
    aplicativo: { findMany: async () => [{ id: aplicativoId, jobs: "CONFIRMACAO_ENTREGA_PRODUCAO", whatsapp: "5511999999999" }] },
    solicitacaoProducao: { findMany: async ({ where }: { where: unknown }) => {
      consultas++;
      assert.deepEqual(where, { aplicativoId, status: "em_producao" });
      return [new Date(), new Date("2020-01-01")].map((createdAt, index) => ({
        id: `producao-${index}`, createdAt, dataEntrega: createdAt,
        prioridadeProducao: false, observacaoGeral: null,
      }));
    } },
    itemSolicitacaoProducao: { findMany: async () => [] },
    notification: { create: async ({ data }: { data: unknown }) => {
      notificacoes.push(data);
      return data;
    } },
  } });
  const { GET } = await import("../src/app/api/cron/cobrar-confirmacao-producao/route");
  assert.equal((await GET(new NextRequest("https://example.test/api/cron"))).status, 401);
  assert.equal(consultas, 0);
  const response = await GET(new NextRequest("https://example.test/api/cron", {
    headers: { Authorization: "Bearer cron-teste" },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notificados, 2);
  assert.equal(notificacoes.length, 2);
});
