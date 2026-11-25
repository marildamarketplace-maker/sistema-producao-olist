import assert from "node:assert/strict";
import test from "node:test";
import { FalhaSync, type ObservacaoRemota } from "../src/lib/olist-sync/contrato";
import { avaliarReplicas, observarRegistro, prepararPayload } from "../src/lib/olist-sync/dominio";
import { serializarCanonico } from "../src/lib/olist-sync/cripto";
import { chaveBaseVendedorContato, idVendedorPorNomeSync, interpretarVendedorContatoSync, lerCatalogoVendedoresContatoSync, payloadVendedorContatoSync, referenciaVendedorContatoSync, resolverVendedorContatoSync } from "../src/lib/olist-sync/vendedores-contato";

const catalogo = [{ id: "101", nome: "Ana Silva", situacao: "B" as const }, { id: "102", nome: "Bia", situacao: "A" as const }];
const contato = (id: number, vendedor: unknown = { id: 101, nome: "Ana Silva" }, email = "a@example.test") => resolverVendedorContatoSync(observarRegistro("CONTATO", { id, nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", situacao: "B", vendedor, email }, { completo: true }), catalogo);
const avaliar = (a: ObservacaoRemota, b: ObservacaoRemota, hashesBase: Record<string, string> | null = null) => avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: a }, { aplicativoId: "b", observacao: b }], hashesBase, visaoCompleta: true, hash: serializarCanonico });
const falha = (codigo: string) => (erro: unknown) => erro instanceof FalhaSync && erro.codigo === codigo;

test("IDs locais diferentes e nomes normalizados geram equivalência", () => {
  const a = contato(1);
  const b = resolverVendedorContatoSync(observarRegistro("CONTATO", { id: 2, nome: "Contato", cpfCnpj: "52998224725", tipoPessoa: "F", situacao: "B", vendedor: { id: 800, nome: " ANA   SILVA " }, email: "a@example.test" }, { completo: true }), [{ id: "800", nome: "Ana Silva", situacao: "B" }]);
  assert.deepEqual(a.campos, b.campos);
  assert.equal(avaliar(a, b).status, "SINCRONIZADO");
  assert.equal(idVendedorPorNomeSync(a.campos.vendedorNome, [{ ...catalogo[0], id: "800" }]), "800");
});

test("primeira divergência e alterações concorrentes deixam contato pendente", () => {
  const ana = contato(1), bia = contato(2, { id: 102, nome: "Bia" });
  assert.ok(avaliar(ana, bia).motivos.includes("DIVERGENCIA_INICIAL:vendedorNome"));
  const base = avaliar(ana, contato(2)).hashes;
  assert.ok(avaliar(contato(1, null), bia, base).motivos.includes("CONFLITO:vendedorNome"));
  assert.equal(avaliar(bia, contato(2), base).status, "PROPAGAR");
  assert.equal(avaliar(bia, contato(2), base).campos?.vendedorNome, "bia");
});

test("ausência na origem preserva cada destino e não restaura o vendedor na próxima auditoria", () => {
  const antes = contato(1), destino = contato(2);
  const base = avaliar(antes, destino).hashes;
  const semVendedor = contato(1, null);
  const preservada = avaliar(semVendedor, destino, base);
  assert.equal(preservada.status, "SINCRONIZADO");
  assert.equal(preservada.campos?.vendedorNome, null);
  assert.equal(preservada.hashes[chaveBaseVendedorContato("a")], serializarCanonico(null));
  assert.equal(preservada.hashes[chaveBaseVendedorContato("b")], serializarCanonico("ana silva"));
  assert.equal(avaliar(semVendedor, destino, preservada.hashes).status, "SINCRONIZADO");
  const emailAlterado = avaliar(contato(1, null, "novo@example.test"), destino, preservada.hashes);
  assert.equal(emailAlterado.status, "PROPAGAR");
  assert.deepEqual(emailAlterado.aplicativosAtualizar, ["b"]);
  assert.equal(emailAlterado.campos?.vendedorNome, null);
});

test("mudança posterior com nome preenchido propaga após preservação", () => {
  const base = avaliar(contato(1), contato(2)).hashes;
  const preservada = avaliar(contato(1, null), contato(2), base);
  const mudou = avaliar(contato(1, { id: 102, nome: "Bia" }), contato(2), preservada.hashes);
  assert.equal(mudou.status, "PROPAGAR");
  assert.equal(mudou.campos?.vendedorNome, "bia");
  assert.deepEqual(mudou.aplicativosAtualizar, ["b"]);
});

test("homônimos, nomes ausentes e vendedores inativos bloqueiam sem escolher candidato", () => {
  assert.throws(() => idVendedorPorNomeSync("Ana Silva", []), falha("VENDEDOR_CONTATO_NAO_MAPEADO"));
  assert.throws(() => idVendedorPorNomeSync("Ana Silva", [...catalogo, { ...catalogo[0], id: "9", situacao: "I" }]), falha("VENDEDOR_CONTATO_AMBIGUO"));
  assert.throws(() => idVendedorPorNomeSync("Ana Silva", [{ ...catalogo[0], situacao: "I" }]), falha("VENDEDOR_CONTATO_INATIVO"));
  const remoto = observarRegistro("CONTATO", { id: 1, nome: "Contato", tipoPessoa: "F", vendedor: { id: 1, nome: "Ana" } }, { completo: true });
  assert.ok(resolverVendedorContatoSync(remoto, []).pendencias.includes("VENDEDOR_CONTATO_NAO_MAPEADO"));
});

test("payload traduz ID local validado sem vazar intenção canônica ou aceitar objeto remoto", () => {
  const seguro = prepararPayload("CONTATO", { ...contato(1).campos, vendedor: { id: 999 } }, { operacao: "ATUALIZAR" });
  assert.equal("vendedor" in seguro, false);
  const enviado = payloadVendedorContatoSync(seguro, "800");
  assert.deepEqual(enviado.vendedor, { id: 800 });
  assert.equal("vendedorNome" in enviado, false);
  assert.throws(() => payloadVendedorContatoSync(seguro, undefined), falha("VENDEDOR_CONTATO_NAO_MAPEADO"));
  assert.equal("vendedor" in payloadVendedorContatoSync({ ...seguro, vendedorNome: null }, null), false);
});

test("referência inválida não é tratada como ausência e nome sem id não autoriza vínculo", () => {
  for (const valor of [{ id: true }, { id: 0 }, { id: "001" }, {}, { nome: "Ana" }, { id: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => referenciaVendedorContatoSync(valor), FalhaSync);
  assert.equal(referenciaVendedorContatoSync(null), null);
  assert.deepEqual(interpretarVendedorContatoSync({ id: 1, contato: { nome: "Ana" }, situacao: "B" }), { id: "1", nome: "Ana", situacao: "B" });
});

test("catálogo durável rejeita conta errada, duplicidade e contagem inconsistente", () => {
  const c = { contaIdentidade: "a", coletadoEm: "2026-11-25T10:00:00.000Z", offset: 2, total: 2, itens: catalogo };
  assert.ok(lerCatalogoVendedoresContatoSync(c, "a"));
  assert.equal(lerCatalogoVendedoresContatoSync(c, "b"), null);
  assert.equal(lerCatalogoVendedoresContatoSync({ ...c, offset: 1 }, "a"), null);
  assert.equal(lerCatalogoVendedoresContatoSync({ ...c, itens: [catalogo[0], catalogo[0]] }, "a"), null);
});

test("criação com vendedor mantém o bloqueio anterior mesmo após resolução", () => {
  const d = avaliarReplicas({ entidade: "CONTATO", replicas: [{ aplicativoId: "a", observacao: contato(1) }, { aplicativoId: "b", observacao: null }], hashesBase: null, visaoCompleta: true, hash: serializarCanonico });
  assert.ok(d.motivos.includes("REFERENCIA_VENDEDOR"));
});
