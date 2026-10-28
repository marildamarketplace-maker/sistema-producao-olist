import { test } from "node:test";
import assert from "node:assert/strict";
import { composicaoKitSchema, expandirItemKit } from "../src/lib/kits-estoque";

test("kit baixa cada componente multiplicado pela quantidade vendida e preserva origem", () => {
  assert.deepEqual(expandirItemKit({ sku: "KIT-A", quantidade: 3, pedido: "123" }, [
    { sku: "A", quantidade: 2 }, { sku: "B", quantidade: 1 },
  ]), [
    { sku: "A", quantidade: 6, pedido: "123", skuOrigem: "KIT-A" },
    { sku: "B", quantidade: 3, pedido: "123", skuOrigem: "KIT-A" },
  ]);
});
test("produto sem associação mantém a baixa original", () => {
  assert.deepEqual(expandirItemKit({ sku: "A", quantidade: 2 }, []), [{ sku: "A", quantidade: 2, skuOrigem: "A" }]);
});
test("rejeita quantidades inválidas e overflow antes de movimentar estoque", () => {
  for (const quantidade of [0, -1, 1.2, NaN, Infinity, 2147483648]) {
    assert.throws(() => expandirItemKit({ sku: "A", quantidade }, []));
  }
  assert.throws(() => expandirItemKit({ sku: "KIT", quantidade: 2147483647 }, [{ sku: "A", quantidade: 2 }]));
});
test("valida composição, impede autorreferência e componentes repetidos", () => {
  for (const componentes of [[{ sku: "KIT", quantidade: 1 }], [{ sku: "A", quantidade: 1 }, { sku: " A ", quantidade: 2 }], [{ sku: "A", quantidade: 0 }], [{ sku: "A", quantidade: 1.5 }]]) {
    assert.equal(composicaoKitSchema.safeParse({ sku: "KIT", componentes }).success, false);
  }
  assert.equal(composicaoKitSchema.safeParse({ sku: " KIT ", componentes: [{ sku: "A", quantidade: 2 }] }).success, true);
  assert.equal(composicaoKitSchema.safeParse({ sku: "KIT", componentes: [] }).success, true);
});
