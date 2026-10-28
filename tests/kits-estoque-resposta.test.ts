import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { lerRespostaKits } from "../src/lib/kits-estoque-resposta";
import { consultarKits, erroApiKits, verificarClienteKits } from "../src/lib/kits-estoque-api";

test("resposta vazia, truncada ou HTML gera mensagem controlada com status", async () => {
  for (const corpo of ["", "{", "<!doctype html><html>Erro interno com detalhe privado</html>"]) {
    await assert.rejects(lerRespostaKits(new Response(corpo, { status: 500 })), (error: Error) => {
      assert.match(error.message, /resposta vazia ou inválida \(HTTP 500\)/);
      assert.doesNotMatch(error.message, /JSON|privado/); return true;
    });
  }
});
test("erro JSON da API é exibido, sem aceitar listagem malformada como sucesso", async () => {
  await assert.rejects(lerRespostaKits(Response.json({ error: "Estrutura indisponível" }, { status: 503 })), /Estrutura indisponível/);
  for (const data of [null, {}, { componentes: null }, { componentes: [{ sku: "A" }] }]) {
    await assert.rejects(lerRespostaKits(Response.json(data)), /listagem de kits inválida/);
  }
  assert.deepEqual(await lerRespostaKits(Response.json({ componentes: [] })), { componentes: [] });
});
test("salvamento exige confirmação explícita da API", async () => {
  await assert.rejects(lerRespostaKits(Response.json({}), "PUT"), /não confirmou o salvamento/);
  await assert.doesNotReject(lerRespostaKits(Response.json({ ok: true }), "PUT"));
  await assert.doesNotReject(lerRespostaKits(Response.json({ kits: 1, componentes: 2 }), "POST"));
});
test("consulta mantém isolamento por aplicativo e retorna o contrato esperado", async () => {
  const db = { componenteKitEstoque: { findMany: async ({ where }: { where: { aplicativoId: string } }) => {
    assert.equal(where.aplicativoId, "app-1"); return [];
  } } } as unknown as PrismaClient;
  assert.deepEqual(await consultarKits(db, "app-1"), { componentes: [] });
});
test("tabela ou coluna ausente retorna diagnóstico sem expor detalhes internos", async () => {
  for (const code of ["P2021", "P2022"]) {
    const erro = { code, message: "postgres://credencial-privada" };
    const db = { componenteKitEstoque: { findMany: async () => { throw erro; } } } as unknown as PrismaClient;
    await assert.rejects(consultarKits(db, "app-1"), (error) => {
      const resposta = erroApiKits(error);
      assert.equal(resposta.status, 503); assert.match(resposta.error, /migration de kits/);
      assert.doesNotMatch(resposta.error, /credencial-privada/); return true;
    });
  }
  assert.equal(erroApiKits(new Error("segredo")).status, 500);
  assert.doesNotMatch(erroApiKits(new Error("segredo")).error, /segredo/);
});
test("cliente Prisma em cache sem modelo novo orienta regeneração e reinício", () => {
  assert.throws(() => verificarClienteKits({} as PrismaClient), (error) => {
    const resposta = erroApiKits(error);
    assert.equal(resposta.status, 503); assert.match(resposta.error, /reinicie o servidor/); return true;
  });
});
