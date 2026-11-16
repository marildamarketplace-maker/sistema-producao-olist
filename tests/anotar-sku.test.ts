import assert from "node:assert/strict";
import test from "node:test";
import { agregarItensSku, atrasoRetrySku, criarBuscaSkuSchema, FalhaConsultaSku } from "../src/lib/anotar-sku/contrato";
import { executarFilaSku, processarEtapaSku } from "../src/services/processarAnotarSkuService";
import type { RepositorioAnotarSku, ReservaSku } from "../src/repositories/anotar-sku-repository";

test("normaliza filtros e rejeita situações, chaves e escopo forjado", () => {
  const entrada = { chave: crypto.randomUUID(), situacoes: ["3", "0", "3"] };
  assert.deepEqual(criarBuscaSkuSchema.parse(entrada).situacoes, ["0", "3"]);
  for (const dado of [{ ...entrada, chave: "inválida" }, { ...entrada, situacoes: [] }, { ...entrada, situacoes: ["100"] }, { ...entrada, aplicativoId: "outro" }]) {
    assert.equal(criarBuscaSkuSchema.safeParse(dado).success, false);
  }
});
test("agrega por SKU sem mudar validação de quantidades e detecta overflow", () => {
  assert.deepEqual(agregarItensSku([
    { produto: { sku: " A " }, quantidade: 2 }, { produto: { sku: "A" }, quantidade: "3" },
    { produto: { sku: "B" }, quantidade: 1.5 }, { produto: { sku: "" }, quantidade: 4 }, { produto: { sku: "C" }, quantidade: -1 },
  ]), [{ sku: "A", quantidade: 5 }]);
  assert.throws(() => agregarItensSku([{ produto: { sku: "A" }, quantidade: 2147483648 }]), FalhaConsultaSku);
  assert.equal(atrasoRetrySku(1, 0, 0), 60_000);
  assert.equal(atrasoRetrySku(4, 0, 0), 480_000);
  assert.equal(atrasoRetrySku(1, 900_000, 0), 900_000);
});
test("preserva a primeira descrição válida da Olist ao agregar o mesmo SKU", () => {
  assert.deepEqual(agregarItensSku([
    { produto: { sku: "A", descricao: " " }, quantidade: 1 },
    { produto: { sku: "A", descricao: " Lenço estampado " }, quantidade: 2 },
    { produto: { sku: "A", descricao: "Outra descrição" }, quantidade: 3 },
    { produto: { sku: "B", descricao: { texto: "inválido" } }, quantidade: 2 },
  ]), [{ sku: "A", quantidade: 6, tituloProduto: "Lenço estampado" }, { sku: "B", quantidade: 2 }]);
});

function fixture(etapa = "DETALHAMENTO", tentativas = 1) {
  const r = { id: "job", aplicativoId: "app", solicitadoPor: "user", reservaId: "lease", situacoes: ["0"], situacaoIndice: 0, paginaOffset: 0, etapa, tentativas } as ReservaSku;
  const chamadas: unknown[][] = [];
  const repo = {
    autorizado: async () => true, proximoPedido: async () => ({ id: "42", ignorado: false }),
    pagina: async (...args: unknown[]) => { chamadas.push(["pagina", ...args]); return true; },
    pedido: async (...args: unknown[]) => { chamadas.push(["pedido", ...args]); return true; },
    prepararConclusao: async () => { chamadas.push(["consolidar"]); return true; },
    concluir: async () => { chamadas.push(["concluir"]); return true; },
    falhar: async (...args: unknown[]) => { chamadas.push(["falhar", ...args]); return true; },
    reservar: async () => r,
  } as unknown as RepositorioAnotarSku;
  const cliente = { listar: async () => ["42"], detalhar: async () => [{ sku: "A", quantidade: 2 }] };
  return { r, repo, cliente, chamadas };
}
test("checkpoint recebe pedido completo; pedido já salvo dispensa consulta externa", async () => {
  const f = fixture();
  assert.equal(await processarEtapaSku(f.r, f.repo, f.cliente), "progresso");
  assert.deepEqual(f.chamadas[0], ["pedido", f.r, "42", [{ sku: "A", quantidade: 2 }], false]);
  f.repo.proximoPedido = async () => ({ id: "42", ignorado: true });
  f.cliente.detalhar = async () => { assert.fail("não deve detalhar pedido já salvo"); };
  await processarEtapaSku(f.r, f.repo, f.cliente);
  assert.deepEqual(f.chamadas[1], ["pedido", f.r, "42", [], true]);
});
test("falha temporária agenda retry; quinta tentativa e erro permanente param", async () => {
  for (const [tentativa, temporaria, esperado] of [[1, true, "retry"], [5, true, "falha"], [1, false, "falha"]] as const) {
    const f = fixture("DETALHAMENTO", tentativa);
    f.cliente.detalhar = async () => { throw new FalhaConsultaSku("TESTE", "Mensagem segura", temporaria, 700_000); };
    assert.equal(await processarEtapaSku(f.r, f.repo, f.cliente), esperado);
    const atraso = f.chamadas[0][4];
    if (esperado === "retry") assert.ok(Number(atraso) >= 700_000); else assert.equal(atraso, null);
  }
});
test("permissão revogada não consulta Olist; erros desconhecidos são sanitizados", async () => {
  const f = fixture(); f.repo.autorizado = async () => false;
  f.cliente.detalhar = async () => { assert.fail("não deve consultar"); };
  assert.equal(await processarEtapaSku(f.r, f.repo, f.cliente), "falha");
  f.repo.autorizado = async () => { throw new Error("segredo-token-banco"); };
  assert.equal(await processarEtapaSku(f.r, f.repo, f.cliente), "retry");
  assert.doesNotMatch(JSON.stringify(f.chamadas), /segredo-token-banco/);
});
test("reserva perdida não é sucesso e orçamento encerrado não consome tentativa", async () => {
  const f = fixture(); f.repo.pedido = async () => null;
  assert.equal(await processarEtapaSku(f.r, f.repo, f.cliente), "reserva_perdida");
  f.repo.reservar = async () => { assert.fail("não deve assumir sem orçamento"); };
  assert.deepEqual(await executarFilaSku(f.repo, f.cliente, { prazo: 120_000, agora: () => 0 }), { progresso: 0, retry: 0, falha: 0, reserva_perdida: 0 });
});
