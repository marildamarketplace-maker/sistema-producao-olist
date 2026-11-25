import type { DadosPedidoFila } from "../src/lib/fila-fornecedor-contrato";
import type { DependenciasRecuperacao } from "../src/lib/fila-recuperacao-olist";
import test from "node:test";
import assert from "node:assert/strict";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fake";
process.env.POSTGRES_PRISMA_URL ??= "postgresql://teste:teste@localhost:5432/teste";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const origem = id(1), destino = id(2), tecido = id(3), plano = id(4);
test("recuperação por campo no novo aplicativo", async t => {
const { recuperarCampoOlist, estadoRecuperacao, correspondeCadastro, condicoesPlano } = await import("../src/lib/fila-recuperacao-olist");
function dados(): DadosPedidoFila {
  return { versao: 1, olist: { filialId: origem, selecoes: { clienteId: 10, vendedorId: 11, formaId: 12, planoId: plano, tipoVenda: "VENDA", tecidos: [{ tecidoId: tecido, id: 13, preco: 9 }], laser: { id: 14, preco: 2 } } },
    itens: [{ produtoId: tecido, sku: "", tecido: { id: tecido, nome: "Oxford Ref. 001", referencia: null }, quantidade: 2, unidade: "UN", quantidadeTecido: 1, unidadeTecido: "MT", estampa: "123", variante: "A", corteLaser: true, tamanho: "70x70", tipoProduto: "Lenço" }] };
}
function ambiente() {
  const chamadas: Array<{ app: string; caminho: string; params: Record<string, string> }> = [];
  let duplicado = false, incompleto = false, falha = false, codigoDestino = "001", preco: unknown = 21.99;
  const deps: DependenciasRecuperacao = {
    vinculo: async () => null,
    planos: async () => [{ id: plano, nome: "30/60" }],
    consultar: async (app, caminho, params, timeout) => {
      assert.ok(timeout > 0 && timeout <= 5000); chamadas.push({ app, caminho, params });
      if (falha) throw new Error("TOKEN PRIVADO");
      if (caminho.includes("/")) return { id: Number(caminho.split("/")[1]), nome: "Oxford Ref. 001", codigo: app === origem ? "001" : codigoDestino, precos: { preco }, situacao: "A" };
      const item = { id: 113, nome: "Oxford Ref. 001", codigo: codigoDestino, situacao: "A" };
      const itens = duplicado ? [item, { ...item, id: 114 }] : [item];
      return { itens, paginacao: { total: incompleto ? 100 : itens.length } };
    },
  };
  return { deps, chamadas, configurar: (v: { duplicado?: boolean; incompleto?: boolean; falha?: boolean; codigoDestino?: string; preco?: unknown }) => { duplicado = v.duplicado ?? false; incompleto = v.incompleto ?? false; falha = v.falha ?? false; codigoDestino = v.codigoDestino ?? "001"; preco = "preco" in v ? v.preco : 21.99; } };
}
await t.test("recupera produto por código exato com preço do destino, sem transportar o preço antigo", async () => {
  const a = ambiente(), d = dados();
  const r = await recuperarCampoOlist(d, destino, `tecido:${tecido}`, null, a.deps);
  assert.equal(r.campo.estado, "RECUPERADO"); assert.deepEqual(r.selecoes.tecidos, [{ tecidoId: tecido, id: 113, preco: 21.99 }]);
  assert.equal(a.chamadas.length, 3); assert.equal(a.chamadas[1].params.codigo, "001"); assert.equal(a.chamadas[1].params.limit, "50");
  assert.equal(d.olist?.selecoes.tecidos?.[0].preco, 9);
});
await t.test("ambiguidade, pesquisa incompleta, conflito e falha mantêm os outros campos", async () => {
  for (const config of [{ duplicado: true }, { incompleto: true }, { falha: true }, { codigoDestino: "002" }, { preco: undefined }]) {
    const a = ambiente(); a.configurar(config); const d = dados();
    d.olistAnterior = d.olist; d.olist = { filialId: destino, selecoes: { clienteId: 110, formaId: 112, tipoVenda: "VENDA" } };
    const r = await recuperarCampoOlist(d, destino, `tecido:${tecido}`, null, a.deps);
    assert.equal(r.campo.estado, "PENDENTE"); assert.equal(r.selecoes.clienteId, 110); assert.equal(r.selecoes.formaId, 112);
    assert.ok(!JSON.stringify(r).includes("TOKEN PRIVADO")); assert.ok(a.chamadas.length <= 3);
  }
});
await t.test("nome exato único aceita caixa/espaços, mas não similaridade ou documentos conflitantes", () => {
  assert.ok(correspondeCadastro({ nome: "  MARIA   SILVA " }, { nome: "Maria Silva" }, true));
  assert.equal(correspondeCadastro({ nome: "Maria Silva" }, { nome: "Maria de Silva" }, true), false);
  assert.equal(correspondeCadastro({ nome: "Maria", cpfCnpj: "12345678909" }, { nome: "Maria", cpfCnpj: "98765432100" }, true), false);
  assert.equal(correspondeCadastro({ nome: "Oxford", codigo: "001" }, { nome: "Oxford", codigo: "1" }), false);
});
await t.test("plano exige nome e condições válidas e associação no novo aplicativo", async () => {
  const d = dados(); d.olistAnterior = d.olist; d.olist = { filialId: destino, selecoes: { formaId: 112 } };
  const a = ambiente();
  let r = await recuperarCampoOlist(d, destino, "planoId", null, a.deps);
  assert.equal(r.campo.estado, "RECUPERADO"); assert.equal(r.selecoes.planoId, plano);
  for (const nome of ["30/90", "Plano comercial", "30/60/90"]) {
    a.deps.planos = async app => [{ id: plano, nome: app === origem ? "30/60" : nome }];
    r = await recuperarCampoOlist(d, destino, "planoId", null, a.deps); assert.equal(r.campo.estado, "PENDENTE");
  }
  assert.deepEqual(condicoesPlano("a vista"), [0]); assert.equal(condicoesPlano("30/-1"), null);
  assert.equal(a.chamadas.length, 0, "planos locais não demandam consulta Olist");
});
await t.test("retoma os não consultados, mantém pendências e reutiliza produto repetido", async () => {
  const a = ambiente(), d = dados(); d.itens.push({ ...d.itens[0], tecido: { ...d.itens[0].tecido, id: id(5) } });
  d.olist!.selecoes.tecidos!.push({ tecidoId: id(5), id: 13, preco: 9 });
  const r = await recuperarCampoOlist(d, destino, `tecido:${tecido}`, null, a.deps);
  d.olistAnterior = d.olist; d.olist = { filialId: destino, selecoes: r.selecoes }; d.recuperacaoOlist = { filialId: destino, campos: [r.campo] };
  const antes = a.chamadas.length;
  const outro = await recuperarCampoOlist(d, destino, `tecido:${id(5)}`, null, a.deps);
  assert.equal(outro.campo.estado, "RECUPERADO"); assert.equal(a.chamadas.length, antes);
  assert.ok(!estadoRecuperacao(d, destino)?.restantes.includes(`tecido:${tecido}`));
  assert.ok(estadoRecuperacao(d, destino)?.restantes.includes("clienteId"));
  assert.equal(estadoRecuperacao(dados(), origem), null, "não recupera quando o aplicativo não mudou");
});
await t.test("orçamento por campo interrompe a leitura antes de aceitar resultados tardios", async () => {
  const a = ambiente(); let tempo = 0; a.deps.agora = () => tempo;
  const consultar = a.deps.consultar; a.deps.consultar = async (...args) => { const r = await consultar(...args); tempo += 13000; return r; };
  const r = await recuperarCampoOlist(dados(), destino, `tecido:${tecido}`, null, a.deps);
  assert.equal(r.campo.estado, "PENDENTE"); assert.equal(a.chamadas.length, 1);
});

});
