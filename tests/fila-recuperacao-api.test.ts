import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import type { PedidoFornecedorQueue, Prisma } from "@prisma/client";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("API recupera e persiste por campo com isolamento, versão e bloqueio de envio", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const matriz = id(1), origem = id(2), destino = id(3), filaId = id(4), usuario = id(5), tecido = id(6);
  const snapshot = { versao: 1, olist: { filialId: origem, selecoes: { tipoVenda: "VENDA", tecidos: [{ tecidoId: tecido, id: 10, preco: 9 }], clienteId: 20 } },
    itens: [{ produtoId: tecido, sku: "", tecido: { id: tecido, nome: "Oxford Ref. 001", referencia: null }, quantidade: 1, unidade: "MT", quantidadeTecido: 1, unidadeTecido: "MT", estampa: "", variante: null, corteLaser: false, tamanho: "", tipoProduto: "" }] };
  let fila: Pick<PedidoFornecedorQueue, "id" | "aplicativoFornecedorId" | "aplicativoSolicitanteId" | "aplicativoFilialId" | "dadosPedido" | "versao" | "status" | "tipoOrigem" | "solicitacaoProducaoId" | "vendedorFixo" | "autorId">;
  let permitido = true, origemPermitida = true, concorrente = false, bloqueado = false, chamadas = 0, gravações = 0;
  const reset = () => { fila = { id: filaId, aplicativoFornecedorId: matriz, aplicativoSolicitanteId: matriz, aplicativoFilialId: destino,
    dadosPedido: structuredClone(snapshot), versao: 0, status: "PENDENTE", tipoOrigem: "PRODUCAO", solicitacaoProducaoId: id(7), vendedorFixo: false, autorId: usuario }; };
  reset();
  const db = {
    usuario: { findUnique: async () => ({ aplicativoId: matriz, podeGerenciarFilaPedidos: permitido, ativo: true }), findFirst: async () => ({ id: usuario, aplicativoId: matriz, ativo: true }) },
    aplicativo: {
      findFirst: async ({ where }: { where: { id?: string } }) => where.id === destino || where.id === origem && origemPermitida ? { id: where.id, nome: "Conta" } : null,
      findUnique: async () => ({ olistClientId: "fake", olistClientSecret: "fake" }),
    },
    integracaoOlistToken: { findUnique: async ({ where }: { where: { aplicativoId_provider: { aplicativoId: string } } }) => ({ accessToken: where.aplicativoId_provider.aplicativoId, expiresAt: new Date(Date.now() + 3600000) }) },
    olistSyncEstado: { findUnique: async () => null },
    pedidoFornecedorQueue: {
      findFirst: async () => structuredClone(fila),
      updateMany: async ({ where, data }: { where: { versao: number; aplicativoFilialId: string }; data: { dadosPedido: Prisma.JsonValue } }) => {
        if (where.versao !== fila.versao || where.aplicativoFilialId !== fila.aplicativoFilialId) return { count: 0 };
        fila.dadosPedido = data.dadosPedido; fila.versao++; gravações++; return { count: 1 };
      },
    },
    envioFornecedor: { findUnique: async () => bloqueado ? { estado: "RESERVADO" } : null },
    envioPedidoManual: { findUnique: async () => bloqueado ? { estado: "RESERVADO" } : null },
    $queryRaw: async () => [{ id: destino }],
  };
  Object.assign(globalThis, { prisma: { ...db, $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuario, email: "teste@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string, options: { headers: { Authorization: string } }) => {
    chamadas++;
    if (concorrente) { fila.versao++; concorrente = false; }
    const u = new URL(url), fonte = options.headers.Authorization.endsWith(origem);
    const item = { id: fonte ? 10 : 110, nome: "Oxford Ref. 001", codigo: "001", precos: { preco: fonte ? 9 : 21.99 }, situacao: "A" };
    const data = u.pathname.endsWith("/produtos") ? { itens: [item], paginacao: { total: 1 } } : u.pathname.includes("/produtos/") ? item : { id: 20, nome: "Cliente", cpfCnpj: null, situacao: "A" };
    return { status: 200, data, headers: { "content-type": "application/json" } };
  });
  const { POST } = await import("../src/app/api/fornecedores/fila/[id]/olist/route");
  const req = (chave = `tecido:${tecido}`, versao = fila.versao, filialId = destino) => POST(new Request("https://example.test/api", {
    method: "POST", headers: { Authorization: "Bearer fake", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "recuperar", chave, versao, filialId }),
  }), { params: Promise.resolve({ id: filaId }) });
  await t.test("sem permissão ou origem de outro grupo não consulta nem grava", async () => {
    permitido = false; assert.equal((await req()).status, 403); permitido = true;
    origemPermitida = false; assert.equal((await req()).status, 403); origemPermitida = true;
    assert.equal(chamadas, 0); assert.equal(gravações, 0);
  });
  await t.test("pedido manual e produção recuperam preço novo e preservam origem", async () => {
    for (const tipo of ["MANUAL", "PRODUCAO"] as const) {
      reset(); fila.tipoOrigem = tipo;
      const response = await req(); assert.equal(response.status, 200); const r = await response.json();
      assert.equal(r.versao, 1); assert.equal(r.selecoes.tecidos[0].id, 110); assert.equal(r.selecoes.tecidos[0].preco, 21.99);
      const salvo = fila.dadosPedido as Prisma.JsonObject;
      assert.deepEqual(salvo.olistAnterior, snapshot.olist);
      assert.equal(r.recuperacao.campos[0].estado, "RECUPERADO");
      assert.ok(!r.recuperacao.restantes.includes(`tecido:${tecido}`));
    }
  });
  await t.test("destino ou versão obsoletos e alteração durante consulta não sobrescrevem dados", async () => {
    reset(); const antes = gravações, consultas = chamadas;
    assert.equal((await req(undefined, 99)).status, 409); assert.equal((await req(undefined, 0, origem)).status, 409);
    assert.equal(chamadas, consultas);
    concorrente = true; assert.equal((await req()).status, 409); assert.equal(gravações, antes); assert.deepEqual(fila.dadosPedido, snapshot);
  });
  await t.test("envio reservado impede persistência e campo arbitrário é rejeitado", async () => {
    reset(); const antes = gravações; bloqueado = true; assert.equal((await req()).status, 409); bloqueado = false;
    assert.equal((await req("senha")).status, 400); assert.equal(gravações, antes);
  });
});
