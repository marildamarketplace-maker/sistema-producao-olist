import assert from "node:assert/strict";
import test from "node:test";

const pai = "00000000-0000-0000-0000-000000000002";
const pedidoId = "00000000-0000-0000-0000-000000000010";
const solicitacaoId = "00000000-0000-0000-0000-000000000011";
const usuarioId = "00000000-0000-0000-0000-000000000012";

test("pai cancela pedido da própria fila respeitando permissão, reserva e versão", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true, aplicativoPai = true, existe = true, enviado = false, falhar = false;
  let status = "PENDENTE", versao = 0, gravacoes = 0, consultas = 0;
  let envio: { estado: string; pedidoOlistId: string | null } | null = null;
  const ordem: string[] = [];
  const tx = {
    pedidoFornecedorQueue: { findFirst: async ({ where, select }: { where: unknown; select: unknown }) => {
      assert.deepEqual(where, { id: pedidoId, aplicativoFornecedorId: pai });
      assert.deepEqual(select, { solicitacaoProducaoId: true, tipoOrigem: true }); consultas++; ordem.push("pedido");
      return existe ? { solicitacaoProducaoId: solicitacaoId } : null;
    } },
    envioFornecedor: { findUnique: async ({ select }: { select: unknown }) => {
      assert.deepEqual(select, { estado: true, pedidoOlistId: true }); ordem.push("envio"); return envio;
    } },
    pedidoFornecedorSolicitacao: { findFirst: async ({ select }: { select: unknown }) => { assert.deepEqual(select, { id: true }); return enviado ? { id: pedidoId } : null; } },
    $queryRaw: async (sql: TemplateStringsArray, id: string) => {
      if (sql.join("?").includes("FOR SHARE")) {
        assert.match(sql.join("?"), /aplicativo_pai_id IS NULL/); assert.equal(id, pai); ordem.push("pai");
        return aplicativoPai ? [{ id: pai }] : [];
      }
      assert.match(sql.join("?"), /FOR UPDATE/); assert.equal(id, solicitacaoId); ordem.push("lock"); return [{ id }];
    },
    $executeRaw: async (sql: TemplateStringsArray, usuario: string, id: string, app: string, versaoEnviada: number) => {
      assert.equal(usuario, usuarioId); assert.equal(id, pedidoId); assert.equal(app, pai);
      const texto = sql.join("?");
      assert.match(texto, /status='CANCELADO'/); assert.match(texto, /status IN \('PENDENTE','FALHADO'\)/);
      assert.match(texto, /versao=versao\+1/); assert.match(texto, /jsonb_set/); assert.match(texto, /cancelamento/);
      ordem.push("cancelar");
      if (falhar) throw new Error("senha-sql-interna");
      if (versaoEnviada !== versao || !["PENDENTE", "FALHADO"].includes(status)) return 0;
      status = "CANCELADO"; versao++; gravacoes++; return 1;
    },
  };
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: usuarioId, aplicativoId: pai }), findUnique: async () => ({ aplicativoId: pai, podeGerenciarFilaPedidos: permitido }) },
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Cancelamento da fila não deve chamar a Olist"); });
  const { POST } = await import("../src/app/api/fornecedores/fila/administracao/route");
  const post = (body: unknown = { acao: "CANCELAR", pedidoId, versao }) => POST(new Request("https://example.test/api", { method: "POST", headers: { Authorization: "Bearer teste" }, body: JSON.stringify(body) }));
  const reset = () => { permitido = true; aplicativoPai = true; existe = true; enviado = false; falhar = false; status = "PENDENTE"; versao = 0; gravacoes = 0; envio = null; ordem.length = 0; };
  await t.test("exige sessão e permissão de gerenciar fila", async () => {
    reset(); assert.equal((await POST(new Request("https://example.test/api", { method: "POST" }))).status, 401);
    permitido = false; assert.equal((await post()).status, 403); assert.equal(consultas, 0);
  });
  await t.test("filho não recebe cancelamento mesmo com permissão", async () => {
    reset(); aplicativoPai = false; assert.equal((await post()).status, 403); assert.equal(gravacoes, 0);
  });
  await t.test("não cancela fila de outro aplicativo", async () => {
    reset(); existe = false; assert.equal((await post()).status, 404); assert.equal(gravacoes, 0);
  });
  await t.test("valida IDs, versão, ação e rejeita aplicativo/status forjados", async () => {
    reset();
    for (const body of [null, {}, { acao: "CANCELAR", pedidoId, versao: -1 }, { acao: "CANCELAR", pedidoId: "inválido", versao: 0 },
      { acao: "CANCELAR", pedidoId, versao: 0, aplicativoFornecedorId: pai }, { acao: "CANCELAR", pedidoId, versao: 0, status: "CONCLUIDO" }]) assert.equal((await post(body)).status, 400);
    assert.equal(gravacoes, 0);
  });
  for (const inicial of ["PENDENTE", "FALHADO"]) await t.test(`cancela ${inicial} sem filial e registra autoria com lock antes de alterar`, async () => {
    reset(); status = inicial; const response = await post(); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: pedidoId, status: "CANCELADO", versao: 1 });
    assert.deepEqual(ordem, ["pedido", "pai", "lock", "envio", "cancelar"]); assert.equal(gravacoes, 1);
  });
  for (const estado of ["RESERVADO", "INCERTO", "CONCLUIDO", "DESCONHECIDO"]) await t.test(`bloqueia envio ${estado}`, async () => {
    reset(); envio = { estado, pedidoOlistId: null }; assert.equal((await post()).status, 409); assert.equal(gravacoes, 0);
  });
  await t.test("envio liberado/rejeitado é cancelável, mas ID remoto ou vínculo existente bloqueiam", async () => {
    for (const estado of ["LIBERADO", "REJEITADO"]) { reset(); envio = { estado, pedidoOlistId: null }; assert.equal((await post()).status, 200); }
    reset(); envio = { estado: "LIBERADO", pedidoOlistId: "123" }; assert.equal((await post()).status, 409);
    reset(); enviado = true; assert.equal((await post()).status, 409); assert.equal(gravacoes, 0);
  });
  await t.test("status encerrados/processando e versão desatualizada não são sobrescritos", async () => {
    for (const bloqueado of ["PROCESSAR", "CONCLUIDO", "CANCELADO"]) { reset(); status = bloqueado; assert.equal((await post()).status, 409); assert.equal(gravacoes, 0); }
    reset(); versao = 2; assert.equal((await post({ acao: "CANCELAR", pedidoId, versao: 1 })).status, 409); assert.equal(gravacoes, 0);
  });
  await t.test("duplo cancelamento concorre por versão e grava uma vez", async () => {
    reset(); const responses = await Promise.all([post({ acao: "CANCELAR", pedidoId, versao: 0 }), post({ acao: "CANCELAR", pedidoId, versao: 0 })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(gravacoes, 1);
  });
  await t.test("falhas não expõem SQL ou credenciais", async () => {
    reset(); falhar = true; const response = await post(); assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /senha-sql/);
  });
});
