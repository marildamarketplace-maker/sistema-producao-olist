import assert from "node:assert/strict";
import test from "node:test";
import { nomeProdutoElegivelSync, observarProducaoSync, producaoCanonicaSync, payloadProducaoSync, primeiraEscritaProdutoSync } from "../src/lib/olist-sync/produtos";
import { observarRegistro, prepararPayload } from "../src/lib/olist-sync/dominio";
import { criarClienteSync, type RequisicaoSync } from "../src/lib/olist-sync/cliente";

const producao = { produtos: [{ sku: "MP-01", quantidade: 1.25 }], etapas: ["Cortar", "Costurar"] };
const fabricado = { sku: "F-01", descricao: "Lenço Ref. 123", tipo: "F", producao };

test("Ref é palavra sem distinção de caixa, com pontuação e Unicode normalizado", () => {
  for (const nome of ["Ref 1", "REF. 123", "Lenço ref: 10", "Ref", "（Ｒｅｆ） 123"]) assert.equal(nomeProdutoElegivelSync(nome), true, nome);
  for (const nome of ["Reforma", "Preferencial", "Ref123", "ref_123", "préRef", "", undefined, null, 123]) assert.equal(nomeProdutoElegivelSync(nome), false, String(nome));
});

test("produto fora do escopo não interpreta nem retém campos alheios ao filtro", () => {
  const obs = observarRegistro("PRODUTO", { id: 1, descricao: "Reforma", sku: 123, dimensoes: "inválido", producao: { segredo: "fora" } }, { completo: true });
  assert.deepEqual(obs.campos, {});assert.equal(obs.chave, null);
  for (const tipo of ["S", "M", "F"]) for (const operacao of ["CRIAR", "ATUALIZAR"] as const)
    assert.throws(() => prepararPayload("PRODUTO", { ...fabricado, descricao: "Sem referência", tipo }, { operacao }), /Ref/);
});

test("produção projeta SKU/quantidade e etapas, eliminando IDs e campos protegidos", () => {
  const raw = { produtos: [{ produto: { id: 90, sku: "MP-01", descricao: "Matéria Ref 1", custos: 100 }, quantidade: 1.25 }], etapas: producao.etapas };
  assert.deepEqual(observarProducaoSync(raw), producao);
  assert.deepEqual(payloadProducaoSync(producao, new Map([["MP-01", "420"]])), { produtos: [{ produto: { id: 420, tipo: "P" }, quantidade: 1.25 }], etapas: producao.etapas });
  for (const ids of [undefined, new Map([["MP-01", "9007199254740993"]]), new Map([["MP-01", "../1"]])]) assert.throws(() => payloadProducaoSync(producao, ids));
  assert.throws(() => observarProducaoSync({ ...raw, produtos: [...raw.produtos, { produto: { id: 91, sku: "IGNORADO", descricao: "Sem marcação" }, quantidade: 1 }] }), /sem Ref/);
});

test("produção rejeita duplicidade, ausência, limites e quantidades inválidas", () => {
  for (const quantidade of [0, -1, Infinity, NaN, "1"]) assert.throws(() => producaoCanonicaSync({ ...producao, produtos: [{ sku: "MP", quantidade }] }));
  for (const valor of [null, {}, { produtos: [], etapas: [] }, { ...producao, produtos: [...producao.produtos, ...producao.produtos] }, { ...producao, produtos: Array.from({ length: 101 }, (_, i) => ({ sku: String(i), quantidade: 1 })) }]) assert.throws(() => producaoCanonicaSync(valor));
  assert.deepEqual(producaoCanonicaSync({ produtos: [], etapas: ["Acabamento"] }), { produtos: [], etapas: ["Acabamento"] });
  const obs = observarRegistro("PRODUTO", { id: 1, ...fabricado, producao: { produtos: [{ produto: { sku: "F-01", descricao: "Ref próprio" }, quantidade: 1 }] } }, { completo: true });
  assert.ok(obs.pendencias.includes("PRODUCAO_CICLICA"));
});

test("comparação de composição independe da ordem e preserva ordem das etapas", () => {
  const itens = [{ sku: "B", quantidade: 2 }, { sku: "A", quantidade: 1 }];
  assert.deepEqual(producaoCanonicaSync({ produtos: itens, etapas: [] }), producaoCanonicaSync({ produtos: [...itens].reverse(), etapas: [] }));
  assert.deepEqual(producaoCanonicaSync(producao).etapas, ["Cortar", "Costurar"]);
});

test("mudanças de cadastro e fabricação usam alvos intermediários explícitos", () => {
  const antigos = { ...fabricado, descricao: "Lenço Ref antigo", producao: { ...producao, etapas: ["Cortar"] } };
  const primeira = primeiraEscritaProdutoSync(fabricado, antigos);
  assert.equal(primeira.somenteProducao, false);assert.deepEqual(primeira.campos.producao, antigos.producao);assert.deepEqual(primeira.producaoPendente, producao);
  assert.equal(primeiraEscritaProdutoSync(fabricado, { ...fabricado, producao: antigos.producao }).somenteProducao, true);
});

test("cliente cria F com produção local e atualiza composição em endpoint próprio", async () => {
  const chamadas: RequisicaoSync[] = [];
  const cliente = criarClienteSync({ configurar: async () => ({ apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }), token: async () => "token",
    http: async r => { chamadas.push(r);return r.url.endsWith("/info") ? { status: 200, dados: { cpfCnpj: "04252011000110", razaoSocial: "Conta" } } : { status: r.metodo === "POST" ? 200 : 204, dados: { id: 1 } }; } });
  const opcoes = { validarConta: () => true, componentesProduto: new Map([["MP-01", "420"]]) };
  await cliente.criar("a", "PRODUTO", fabricado, opcoes);
  assert.deepEqual((chamadas.at(-1)!.payload as Record<string, unknown>).producao, payloadProducaoSync(producao, opcoes.componentesProduto));
  await cliente.atualizar("a", "PRODUTO", "1", fabricado, { ...opcoes, somenteProducao: true });
  assert.ok(chamadas.at(-1)!.url.endsWith("/produtos/1/fabricado"));assert.deepEqual(chamadas.at(-1)!.payload, payloadProducaoSync(producao, opcoes.componentesProduto));
  await cliente.atualizar("a", "PRODUTO", "1", fabricado, opcoes);
  assert.ok(chamadas.at(-1)!.url.endsWith("/produtos/1"));assert.equal("producao" in (chamadas.at(-1)!.payload as object), false);
  const antes = chamadas.length;await assert.rejects(cliente.criar("a", "PRODUTO", fabricado));assert.equal(chamadas.length, antes);
});
