import assert from "node:assert/strict";
import test from "node:test";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("listagem de produção informa fornecedor e bloqueio de vendedor sem ocultar filas existentes", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true, temFornecedor = true, temVendedor = false, falhaDisponibilidade = false;
  const fila = { id: id(9), solicitacaoProducaoId: id(8), status: "PENDENTE" };
  const db = {
    usuario: {
      findFirst: async () => ({ id: id(1), aplicativoId: id(2), ativo: true }),
      findUnique: async () => ({ podeSolicitarProducao: permitido, podeVisualizarProducao: permitido, podeConfirmarProducao: false, podeSelecionarFilialFornecedor: true }),
    },
    aplicativo: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR
      ? [{ id: id(2), nome: "Origem" }] : [{ id: id(4), nome: "Conta do fornecedor", aplicativoPaiId: id(3) }] },
    fornecedor: { findMany: async () => temFornecedor ? [{ id: id(5), aplicativoPai: { id: id(3), nome: "Fornecedor" } }] : [] },
    usuarioVendedorOlist: { findMany: async () => temVendedor ? [{ aplicativoId: id(4), vendedorOlistId: 20,
      revisao: 1, origemAplicativoId: id(2), fornecedorMatrizId: id(3), confirmadoEm: new Date(), revogadoEm: null,
      aplicativo: { id: id(4), aplicativoPaiId: id(3) } }] : [] },
    pedidoFornecedorSolicitacao: { findMany: async () => [] },
    pedidoFornecedorQueue: { findMany: async ({ where }: { where: { aplicativoSolicitanteId: string } }) => {
      assert.equal(where.aplicativoSolicitanteId, id(2)); return [fila];
    } },
  };
  Object.assign(globalThis, { prisma: { ...db, $transaction: async (operar: (tx: typeof db) => unknown) => {
    if (falhaDisponibilidade) throw new Error("Falha interna que não deve ser exposta");
    return operar(db);
  } } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: id(1), email: "test@example.test" } }, error: null }));
  const { GET } = await import("../src/app/api/solicitacoes-producao/pedidos-fornecedor/route");
  const ler = () => GET(new Request("https://example.test", { headers: { Authorization: "Bearer teste" } }));

  temFornecedor = false;
  const semFornecedor = await ler(); assert.equal(semFornecedor.status, 200);
  assert.deepEqual((await semFornecedor.json()).envioFornecedor, { temFornecedor: false, podeEnviar: false, motivoBloqueio: null });
  temFornecedor = true;
  const bloqueada = await (await ler()).json();
  assert.equal(bloqueada.envioFornecedor.temFornecedor, true);
  assert.equal(bloqueada.envioFornecedor.podeEnviar, false);
  assert.match(bloqueada.envioFornecedor.motivoBloqueio, /vendedor vinculado/);
  assert.deepEqual(bloqueada.filas, [fila]);
  temVendedor = true;
  assert.deepEqual((await (await ler()).json()).envioFornecedor, { temFornecedor: true, podeEnviar: true, motivoBloqueio: null });
  falhaDisponibilidade = true;
  const recuperavel = await ler(); assert.equal(recuperavel.status, 200);
  const json = await recuperavel.json();
  assert.deepEqual(json.filas, [fila]); assert.equal(json.envioFornecedor.podeEnviar, false);
  assert.match(json.envioFornecedor.motivoBloqueio, /Atualize a página/);
  assert.doesNotMatch(JSON.stringify(json), /Falha interna/);
  permitido = false;
  assert.equal((await ler()).status, 403);
});
