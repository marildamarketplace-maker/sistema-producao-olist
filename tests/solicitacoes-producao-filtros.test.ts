import assert from "node:assert/strict";
import test from "node:test";
import { FILTROS_SOLICITACOES_INICIAIS as iniciais, filtrarSolicitacoes } from "../src/lib/solicitacoes-producao-filtros";

const solicitacoes = [
  { id: "a", observacao_geral: "Produção de LENÇOS", status: "concluida", data_entrega: "2026-10-07", created_at: "2026-10-08T02:59:59Z" },
  { id: "b", observacao_geral: null, status: "cancelada", data_entrega: "2026-10-08", created_at: "2026-10-08T03:00:00Z" },
];
const pedidos = { a: ["12345", "67890"] };
const ids = (filtros: Partial<typeof iniciais>) => filtrarSolicitacoes(solicitacoes, { ...iniciais, ...filtros }, pedidos).map((item) => item.id);

test("sem filtros preserva registros e ordenação", () => {
  assert.deepEqual(ids({}), ["a", "b"]);
});

test("busca parcial por observação ignora caixa, acentos e espaços externos", () => {
  assert.deepEqual(ids({ observacao: " LENCOS " }), ["a"]);
  assert.deepEqual(ids({ observacao: "inexistente" }), []);
});

test("combina status, observação, entrega inclusiva e qualquer ID Olist vinculado", () => {
  assert.deepEqual(ids({ status: "concluida", observacao: "producao", entregaInicio: "2026-10-07", entregaFim: "2026-10-07", pedidoOlist: " 789 " }), ["a"]);
  assert.deepEqual(ids({ status: "cancelada", pedidoOlist: "123" }), []);
  assert.deepEqual(ids({ entregaInicio: "2026-10-08" }), ["b"]);
  assert.deepEqual(ids({ entregaFim: "2026-10-07" }), ["a"]);
});

test("criação usa dias inclusivos no horário de Brasília, inclusive na virada UTC", () => {
  assert.deepEqual(ids({ criacaoInicio: "2026-10-07", criacaoFim: "2026-10-07" }), ["a"]);
  assert.deepEqual(ids({ criacaoInicio: "2026-10-08" }), ["b"]);
  assert.deepEqual(ids({ criacaoFim: "2026-10-07" }), ["a"]);
});

test("intervalos invertidos não retornam registros", () => {
  assert.deepEqual(ids({ entregaInicio: "2026-10-08", entregaFim: "2026-10-07" }), []);
  assert.deepEqual(ids({ criacaoInicio: "2026-10-08", criacaoFim: "2026-10-07" }), []);
});

test("intervalo inicial usa hoje e sete dias antes, inclusive na virada UTC e de ano", async () => {
  const { criarFiltrosSolicitacoesIniciais } = await import("../src/lib/solicitacoes-producao-filtros");
  assert.deepEqual(criarFiltrosSolicitacoesIniciais(new Date("2026-10-16T12:00:00Z")), { ...iniciais, criacaoInicio: "2026-10-09", criacaoFim: "2026-10-16" });
  assert.deepEqual(criarFiltrosSolicitacoesIniciais(new Date("2026-10-16T02:00:00Z")), { ...iniciais, criacaoInicio: "2026-10-08", criacaoFim: "2026-10-15" });
  assert.deepEqual(criarFiltrosSolicitacoesIniciais(new Date("2027-01-03T12:00:00Z")), { ...iniciais, criacaoInicio: "2026-12-27", criacaoFim: "2027-01-03" });
  assert.equal(iniciais.criacaoInicio, "");
});
