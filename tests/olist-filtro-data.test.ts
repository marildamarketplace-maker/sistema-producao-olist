import assert from "node:assert/strict";
import test from "node:test";
import {
  aplicarFiltroDataPedidosOlist,
  obterDataAtualizacaoPadrao,
} from "../src/lib/olist-filtro-data";

test("data de atualização padrão usa uma janela móvel de sete dias", () => {
  const referencia = new Date("2026-10-09T02:50:00.000Z");

  assert.equal(
    obterDataAtualizacaoPadrao(referencia).toISOString(),
    "2026-10-02T02:50:00.000Z",
  );
});

test("baixa automática filtra somente pela data de atualização", () => {
  const url = new URL("https://api.tiny.com.br/public-api/v3/pedidos");

  aplicarFiltroDataPedidosOlist(url, {
    tipo: "atualizacao",
    desde: new Date("2026-10-02T02:50:00.000Z"),
  });

  assert.equal(url.searchParams.get("dataAtualizacao"), "2026-10-02");
  assert.equal(url.searchParams.has("dataInicial"), false);
  assert.equal(url.searchParams.has("dataFinal"), false);
});

test("buscas por criação preservam data inicial e final", () => {
  const url = new URL("https://api.tiny.com.br/public-api/v3/pedidos");

  aplicarFiltroDataPedidosOlist(url, {
    tipo: "criacao",
    periodoInicio: new Date("2026-10-01T00:00:00.000Z"),
    periodoFim: new Date("2026-10-02T23:59:59.000Z"),
  });

  assert.equal(url.searchParams.get("dataInicial"), "2026-10-01");
  assert.equal(url.searchParams.get("dataFinal"), "2026-10-02");
  assert.equal(url.searchParams.has("dataAtualizacao"), false);
});
