import assert from "node:assert/strict";
import test from "node:test";
import { consultaPedidosSkuSchema, linkPedidoOlist, paginaPedidosSkuSchema } from "../src/lib/anotar-sku/pedidos";

test("consulta preserva SKU exato e não converte IDs grandes em números", () => {
  const entrada = { id: crypto.randomUUID(), sku: " LENCO/90 & 90+A ", cursor: "90071992547409931234" };
  assert.deepEqual(consultaPedidosSkuSchema.parse(entrada), entrada);
  assert.equal(paginaPedidosSkuSchema.parse({ pedidos: [{ id: entrada.cursor, quantidade: 4 }], proximoCursor: null }).pedidos[0].id, entrada.cursor);
  assert.equal(paginaPedidosSkuSchema.safeParse({ pedidos: Array.from({ length: 51 }, () => ({ id: "1", quantidade: 1 })), proximoCursor: null }).success, false);
});

test("link abre o pedido na rota existente da Olist com ID codificado e host fixo", () => {
  assert.equal(linkPedidoOlist("90071992547409931234"), "https://erp.olist.com/vendas#edit/90071992547409931234");
  assert.equal(linkPedidoOlist("123/#?&"), "https://erp.olist.com/vendas#edit/123%2F%23%3F%26");
  assert.equal(new URL(linkPedidoOlist("javascript:alert(1)")).origin, "https://erp.olist.com");
});
