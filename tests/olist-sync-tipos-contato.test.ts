import assert from "node:assert/strict";
import test from "node:test";
import { FalhaSync } from "../src/lib/olist-sync/contrato";
import { avaliarReplicas, observarRegistro, normalizarTelefoneContato, prepararPayload } from "../src/lib/olist-sync/dominio";
import { serializarCanonico } from "../src/lib/olist-sync/cripto";
import { interpretarTipoContatoSync, lerCatalogoTiposContatoSync, payloadTiposContatoSync, referenciasTiposContatoSync, resolverTiposContatoSync } from "../src/lib/olist-sync/tipos-contato";

const origem = [{ id: "1", nome: "Cliente", perfilContato: 0 }];
const destino = [{ id: "87", nome: " CLIENTE  ", perfilContato: 0 }];
const contato = (tipos: unknown = [{ id: 1, descricao: "Cliente" }], celular = "(11) 91234-5678") => observarRegistro("CONTATO", {
  id: 10, nome: "Contato", tipoPessoa: "F", cpfCnpj: "529.982.247-25", situacao: "B", tipos, celular,
}, { completo: true });
const falha = (codigo: string) => (error: unknown) => error instanceof FalhaSync && error.codigo === codigo;

test("perfil do catálogo aceita enum numérico ou string numérica canônica da API real", () => {
  for (let perfil = 0; perfil <= 5; perfil++) {
    const numerico = interpretarTipoContatoSync({ id: 10, nome: "Tipo", perfilContato: perfil });
    const textual = interpretarTipoContatoSync({ id: 10, nome: "Tipo", perfilContato: String(perfil) });
    assert.deepEqual(textual, numerico);
    assert.equal(typeof textual.perfilContato, "number");
  }
});

test("perfil não usa coerção genérica nem aceita enum desconhecido", () => {
  for (const perfilContato of [null, undefined, true, false, "", " ", "01", "1.0", "1e0", " 1 ", "Cliente", "6", 6, -1, 1.5, [], {}])
    assert.throws(() => interpretarTipoContatoSync({ id: 10, nome: "Tipo", perfilContato }), falha("CONTRATO"));
});

test("tipos usam nome e perfil na comparação, nunca o ID da origem no payload", () => {
  const a = resolverTiposContatoSync(contato(), origem);
  const b = resolverTiposContatoSync(contato([{ id: 87, descricao: "CLIENTE" }]), destino);
  assert.deepEqual(a.campos, b.campos);
  assert.equal(a.tiposContatoRemotos, undefined);
  assert.deepEqual(a.pendencias, []);
  assert.deepEqual(payloadTiposContatoSync(prepararPayload("CONTATO", a.campos, { operacao: "CRIAR" }), destino).tipos, [87]);
  assert.equal("tiposContato" in payloadTiposContatoSync(a.campos, destino), false);
});

test("tipos não mapeados e catálogos ambíguos conservam referências e bloqueiam propagação", () => {
  for (const catalogo of [[], [{ ...origem[0], nome: "Fornecedor" }]]) {
    const obs = resolverTiposContatoSync(contato(), catalogo);
    assert.ok(obs.pendencias.includes("TIPOS_CONTATO_NAO_MAPEADOS"));
    assert.deepEqual(obs.tiposContatoRemotos, [{ id: "1", descricao: "Cliente" }]);
    const decisao = avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: obs }, { aplicativoId: "b", observacao: null }], visaoCompleta: true, hashesBase: null, hash: serializarCanonico });
    assert.equal(decisao.status, "AGUARDANDO_REVISAO");
  }
  const repetidos = [...origem, { ...origem[0], id: "2", nome: " CLIENTE " }];
  assert.ok(resolverTiposContatoSync(contato(), repetidos).pendencias.includes("TIPOS_CONTATO_AMBIGUOS"));
  assert.throws(() => payloadTiposContatoSync({ tiposContato: [{ nome: "Cliente", perfilContato: 0 }] }, repetidos), falha("TIPOS_CONTATO_AMBIGUOS"));
});

test("nome sozinho não prova equivalência quando perfis diferem", () => {
  const campos = resolverTiposContatoSync(contato(), origem).campos;
  assert.throws(() => payloadTiposContatoSync(campos, [{ ...destino[0], perfilContato: 1 }]), falha("TIPOS_CONTATO_NAO_MAPEADOS"));
  assert.throws(() => payloadTiposContatoSync(campos), falha("TIPOS_CONTATO_NAO_MAPEADOS"));
  assert.throws(() => payloadTiposContatoSync(campos, [...destino, { ...destino[0], nome: "Fornecedor" }]), falha("CATALOGO_TIPOS_INCONSISTENTE"));
});

test("tipos vazios explícitos são preservados; campo ausente não apaga tipos existentes", () => {
  assert.deepEqual(payloadTiposContatoSync({ nome: "Contato" }), { nome: "Contato" });
  assert.deepEqual(payloadTiposContatoSync(resolverTiposContatoSync(contato([]), []).campos).tipos, []);
  assert.deepEqual(referenciasTiposContatoSync(null), []);
  assert.equal(observarRegistro("CONTATO", { id: 10, nome: "Contato", tipos: [{ id: 1 }] }).tiposContatoRemotos, undefined);
});

test("referências rejeitam IDs repetidos, valores não inteiros e precisão perdida", () => {
  for (const tipos of [[{ id: 1 }, { id: "1" }], [{ id: 0 }], [{ id: 1.2 }], [{ id: Number.MAX_SAFE_INTEGER + 1 }], [{ id: "001" }]])
    assert.throws(() => referenciasTiposContatoSync(tipos), FalhaSync);
});

test("checkpoint de catálogo é isolado pela identidade da conta e valida contagem e duplicatas", () => {
  const catalogo = { contaIdentidade: "conta-a", coletadoEm: "2026-11-18T10:00:00.000Z", offset: 1, total: 1, itens: origem };
  assert.ok(lerCatalogoTiposContatoSync(catalogo, "conta-a"));
  assert.equal(lerCatalogoTiposContatoSync(catalogo, "conta-b"), null);
  assert.equal(lerCatalogoTiposContatoSync({ ...catalogo, offset: 2 }, "conta-a"), null);
  assert.equal(lerCatalogoTiposContatoSync({ ...catalogo, offset: 2, total: 2, itens: [...origem, ...origem] }, "conta-a"), null);
});

test("formatação e prefixo brasileiro equivalentes evitam conflito inicial de celular", () => {
  const a = resolverTiposContatoSync(contato([], "(11) 91234-5678"), []);
  const b = resolverTiposContatoSync(contato([], "+55 11 91234-5678"), []);
  const avaliar = (outra: typeof b) => avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: a }, { aplicativoId: "b", observacao: outra }], visaoCompleta: true, hashesBase: null, hash: serializarCanonico });
  assert.equal(avaliar(b).status, "SINCRONIZADO");
  assert.ok(avaliar(resolverTiposContatoSync(contato([], "11999999999"), [])).motivos.includes("DIVERGENCIA_INICIAL:celular"));
});

test("normalização conserva ramais, listas, números estrangeiros e zeros significativos", () => {
  for (const numero of ["011912345678", "+1 11912345678", "11912345678 ramal 123", "11912345678 / 11987654321"])
    assert.equal(normalizarTelefoneContato(numero), numero);
  assert.equal(normalizarTelefoneContato("55 (11) 91234-5678"), "11912345678");
  assert.equal(normalizarTelefoneContato("   "), null);
});
