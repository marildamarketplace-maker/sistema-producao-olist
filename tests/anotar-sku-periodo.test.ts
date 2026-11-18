import assert from "node:assert/strict";
import test from "node:test";
import { criarBuscaSkuSchema } from "../src/lib/anotar-sku/contrato";
import { dataCriacaoPedidoSku, hojeSku, periodoPadraoSku, periodoSkuSchema } from "../src/lib/anotar-sku/periodo";

test("período padrão inclui hoje e os 14 dias anteriores no calendário de São Paulo", () => {
  assert.equal(hojeSku(new Date("2026-11-18T01:00:00Z")), "2026-11-17");
  assert.deepEqual(periodoPadraoSku(new Date("2026-11-18T01:00:00Z")), { periodoInicio: "2026-11-03", periodoFim: "2026-11-17" });
  assert.deepEqual(periodoPadraoSku(new Date("2026-01-01T12:00:00Z")), { periodoInicio: "2025-12-18", periodoFim: "2026-01-01" });
  assert.deepEqual(periodoPadraoSku(new Date("2024-03-01T12:00:00Z")), { periodoInicio: "2024-02-16", periodoFim: "2024-03-01" });
});

test("contrato aceita clientes antigos e exige período completo, real, ordenado e limitado", () => {
  const entrada = { chave: crypto.randomUUID(), situacoes: ["0"] };
  assert.equal(criarBuscaSkuSchema.safeParse(entrada).success, true);
  assert.equal(criarBuscaSkuSchema.safeParse({ ...entrada, periodoInicio: "2024-02-29", periodoFim: "2024-02-29" }).success, true);
  const invalidos = [
    { periodoInicio: "2024-01-01" }, { periodoFim: "2024-01-01" },
    { periodoInicio: "2023-02-29", periodoFim: "2023-03-01" },
    { periodoInicio: "2024-02-30", periodoFim: "2024-03-01" },
    { periodoInicio: "2024-01-02", periodoFim: "2024-01-01" },
    { periodoInicio: "2099-01-01", periodoFim: "2099-01-02" },
    { periodoInicio: "2024-01-01", periodoFim: "2025-01-01" },
    { periodoInicio: "", periodoFim: "2024-01-01" },
  ];
  for (const periodo of invalidos) assert.equal(criarBuscaSkuSchema.safeParse({ ...entrada, ...periodo }).success, false, JSON.stringify(periodo));
  assert.equal(periodoSkuSchema.safeParse({ periodoInicio: "2024-01-01", periodoFim: "2024-12-31" }).success, true);
});

test("data de criação preserva datas locais e normaliza instantes para São Paulo", () => {
  for (const valor of ["2026-11-17", "2026-11-17 23:59:59", "2026-11-17T23:59:59", "2026-11-18T01:00:00Z", "2026-11-17T23:59:59-03:00"]) {
    assert.equal(dataCriacaoPedidoSku(valor), "2026-11-17", valor);
  }
  for (const valor of [undefined, null, 123, "", "inválida", "2026-02-30", "2026-11-17T25:00:00", "17/11/2026"]) {
    assert.equal(dataCriacaoPedidoSku(valor), null);
  }
});
