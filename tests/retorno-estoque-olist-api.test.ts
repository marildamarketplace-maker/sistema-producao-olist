import assert from "node:assert/strict";
import test from "node:test";

test("APIs de retorno exigem sessão, permissão e contrato restrito antes de acessar o serviço", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste";
  let leitura = true, escrita = false, ativo = true, retornoExiste = true;
  Object.assign(globalThis, { prisma: { usuario: {
    findFirst: async () => ({ id: "usuario", aplicativoId: "app" }),
    findUnique: async () => ({ ativo, aplicativoId: "app", podeVisualizarDevolucao: leitura, podeSolicitarDevolucao: escrita }),
  }, retornoEstoqueOlist: { findFirst: async ({ where }: { where: { aplicativoId: string } }) => {
    assert.equal(where.aplicativoId, "app"); return retornoExiste ? { itens: [] } : null;
  } } } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  const { retornoOlistService } = await import("../src/lib/retorno-estoque-olist-api");
  const buscar = t.mock.method(retornoOlistService, "buscar", async (app: string) => { assert.equal(app, "app"); return { data_atualizacao: "2026-10-20", pedidos: [] }; });
  const confirmar = t.mock.method(retornoOlistService, "confirmar", async (app: string, usuario: string) => { assert.equal(app, "app"); assert.equal(usuario, "usuario"); return { retorno_id: "retorno", itens: 1, quantidade: 1 }; });
  t.mock.method(retornoOlistService, "historico", async () => ({ retornos: [], tem_mais: false }));
  const busca = await import("../src/app/api/olist/retorno-estoque/buscar/route");
  const confirma = await import("../src/app/api/olist/retorno-estoque/confirmar/route");
  const historico = await import("../src/app/api/olist/retorno-estoque/historico/route");
  const validarNota = await import("../src/app/api/olist/retorno-estoque/validar-nota/route");
  const notaPayload = { retorno_id: "30000000-0000-4000-8000-000000000001" };
  const req = (body?: unknown, autenticado = true, query = "") => new Request(`https://example.test/${query}`, {
    method: body ? "POST" : "GET", headers: { ...(autenticado ? { Authorization: "Bearer ficticio" } : {}), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = { chave_idempotencia: "30000000-0000-4000-8000-000000000001", itens: [{ item_baixa_id: "20000000-0000-4000-8000-000000000001", quantidade: 1 }] };
  assert.equal((await busca.GET(req(undefined, false))).status, 401);
  assert.equal((await busca.POST(req({}))).status, 200);
  assert.equal(buscar.mock.callCount(), 1);
  assert.equal((await confirma.POST(req(payload))).status, 403);
  assert.equal(confirmar.mock.callCount(), 0);
  assert.equal((await validarNota.POST(req(notaPayload, false))).status, 401);
  assert.equal((await validarNota.POST(req(notaPayload))).status, 200);
  assert.equal((await validarNota.POST(req({ ...notaPayload, aplicativo_id: "outro" }))).status, 400);
  assert.equal((await validarNota.POST(req({ retorno_id: "invalido" }))).status, 400);
  retornoExiste = false;
  assert.equal((await validarNota.POST(req(notaPayload))).status, 404);
  leitura = false;
  assert.equal((await validarNota.POST(req(notaPayload))).status, 403);
  assert.equal((await busca.GET(req())).status, 403);
  assert.equal((await historico.GET(req())).status, 403);
  escrita = true;
  assert.equal((await confirma.POST(req(payload))).status, 200);
  assert.equal((await busca.POST(req({ data_atualizacao: "2026-02-30" }))).status, 400);
  assert.equal((await confirma.POST(req({ ...payload, aplicativo_id: "outro" }))).status, 400);
  assert.equal((await historico.GET(req(undefined, true, "?pagina=-1"))).status, 400);
  assert.equal((await confirma.POST(req({ ...payload, itens: [{ ...payload.itens[0], quantidade: 1.2 }] }))).status, 400);
  assert.equal((await historico.GET(req())).status, 200);
  ativo = false;
  assert.equal((await confirma.POST(req(payload))).status, 403);
  assert.equal(confirmar.mock.callCount(), 1);
});
