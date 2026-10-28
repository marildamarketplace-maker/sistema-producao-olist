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

test("bloqueia baixa de kit sem composição em vez de descontar o SKU do kit", () => {
  for (const sku of ["KIT2-AFRO-1/70X70-6913-E-1/150X150-6913-A", " kit-exemplo "]) {
    assert.throws(() => expandirItemKit({ sku, quantidade: 1 }, []), /sem associação de componentes/);
  }
});
test("kit associado gera somente componentes, sem saída adicional do kit", () => {
  const itens = expandirItemKit({ sku: "KIT-A", quantidade: 4 }, [{ sku: "INDIVIDUAL", quantidade: 2 }]);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].sku, "INDIVIDUAL");
  assert.equal(itens[0].quantidade, 8);
  assert.equal(itens.some((item) => item.sku === "KIT-A"), false);
});
