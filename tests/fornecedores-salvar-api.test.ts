import assert from "node:assert/strict";
import test from "node:test";

const origem = "00000000-0000-0000-0000-000000000001";
const pai = "00000000-0000-0000-0000-000000000002";
const id = "00000000-0000-0000-0000-000000000003";
const outroPai = "00000000-0000-0000-0000-000000000004";
const usuarioId = "00000000-0000-0000-0000-000000000005";
type Fornecedor = { id: string; aplicativoId: string; aplicativoPaiId: string; ativo: boolean; nome: string; meuClienteOlistId: number; encerradoEm?: Date };

test("cadastro de fornecedor: autorização, encerramento idempotente e preservação de histórico", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true, matrizValida = true;
  let dados: Fornecedor[] = [{ id, aplicativoId: origem, aplicativoPaiId: pai, ativo: true, nome: "Anterior", meuClienteOlistId: 123 }];
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async (sql: TemplateStringsArray, ...valores: string[]) => sql.join("").includes("FROM aplicativo") ? (matrizValida ? [{ id: valores[0] }] : []) : [{ id: usuarioId }],
    usuario: { findFirst: async () => ({ id: usuarioId, aplicativoId: origem, ativo: true }), findUnique: async () => ({ id: usuarioId, aplicativoId: origem, ativo: true, podeVisualizarFornecedores: permitido }) },
    fornecedor: {
      findFirst: async ({ where }: { where: { id: string; aplicativoId: string; ativo?: boolean } }) => dados.find(f => f.id === where.id && f.aplicativoId === where.aplicativoId && (where.ativo === undefined || f.ativo === where.ativo)) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; aplicativoId: string; aplicativoPaiId: string; ativo: boolean }; data: Partial<Fornecedor> }) => {
        const alvo = dados.find(f => f.id === where.id && f.aplicativoId === where.aplicativoId && f.aplicativoPaiId === where.aplicativoPaiId && f.ativo === where.ativo);
        if (!alvo) return { count: 0 }; Object.assign(alvo, data); return { count: 1 };
      },
      create: async ({ data }: { data: Omit<Fornecedor, "id" | "meuClienteOlistId"> }) => {
        const novo = { ...data, id: outroPai, meuClienteOlistId: 0 }; dados.push(novo); return { id: novo.id };
      },
    },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async <T,>(fn: (cliente: typeof tx) => Promise<T>) => {
    const antes = structuredClone(dados); try { return await fn(tx); } catch (error) { dados = antes; throw error; }
  } } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  const { POST, DELETE } = await import("../src/app/api/fornecedores/salvar/route");
  const request = (payload: unknown, method = "POST") => new Request("https://example.test", { method, headers: { Authorization: "Bearer teste" }, body: JSON.stringify(payload) });
  const body = { id, aplicativo_pai_id: pai, nome: "MV Tecidos", endereco: null };
  assert.equal((await POST(new Request("https://example.test", { method: "POST" }))).status, 401);
  permitido = false; assert.equal((await POST(request(body))).status, 403); permitido = true;
  for (const payload of [{ ...body, aplicativo_pai_id: null }, { ...body, aplicativo_id: pai }, { ...body, nome: "" }, { ...body, meu_cliente_olist_id: 7 }]) assert.equal((await POST(request(payload))).status, 400);
  matrizValida = false; assert.equal((await POST(request(body))).status, 400); matrizValida = true;
  assert.equal((await POST(request(body))).status, 200);
  assert.equal(dados[0].nome, "MV Tecidos"); assert.equal(dados[0].meuClienteOlistId, 123);
  assert.equal((await POST(request({ ...body, id: usuarioId }))).status, 404);
  const troca = await POST(request({ ...body, aplicativo_pai_id: outroPai }));
  assert.equal(troca.status, 201); assert.equal((await troca.json()).id, outroPai);
  assert.equal(dados[0].ativo, false); assert.equal(dados[0].aplicativoPaiId, pai); assert.equal(dados[0].meuClienteOlistId, 123);
  assert.equal(dados[1].aplicativoPaiId, outroPai); assert.equal(dados[1].ativo, true); assert.equal(dados[1].meuClienteOlistId, 0);
  assert.equal((await DELETE(request({ id: outroPai }, "DELETE"))).status, 200);
  assert.equal((await DELETE(request({ id: outroPai }, "DELETE"))).status, 200);
  assert.equal(dados.length, 2); assert.equal(dados[1].ativo, false);
  assert.equal((await DELETE(request({ id: usuarioId }, "DELETE"))).status, 404);
  assert.equal((await POST(request(body))).status, 404, "cadastro encerrado não é reativado por edição antiga");
});
