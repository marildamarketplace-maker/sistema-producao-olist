import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("disparo manual executa habilidade real com bloqueio e autorização", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticia";
  const aplicativoId = randomUUID(), rotinaId = randomUUID(), habilidadeId = randomUUID(), versaoId = randomUUID();
  const usuario = { ativo: true, aplicativoId, podeVisualizarAutomatizacao: true, podeIntervirAutomatizacao: true };
  let encontrada = true, disponivel = true, criadas = 0, locks = 0;
  let existente: { id: string; status: string } | null = null;
  const tx = {
    $queryRaw: async (_sql: TemplateStringsArray, ...values: string[]) => {
      locks++;
      assert.deepEqual(values, [rotinaId, aplicativoId]);
      return encontrada ? [{ habilidadeId }] : [];
    },
    execucaoAutomatizacao: {
      findFirst: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { aplicativoId, rotinaId, tipo: { not: "TESTE_ROTINA" }, status: { not: "CONCLUIDA" } });
        return existente;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        criadas++;
        assert.equal(data.tipo, "EXECUTAR_PROMPT");
        assert.equal(data.versaoId, versaoId);
        assert.equal(data.aplicativoId, aplicativoId);
        assert.equal(data.rotinaId, rotinaId);
        assert.ok(data.previstoEm instanceof Date);
        existente = { id: randomUUID(), status: "PENDENTE" };
        return { id: existente.id };
      },
    },
    versaoHabilidadeAutomatizacao: { findFirst: async (query: { where: unknown; orderBy: unknown }) => {
      assert.deepEqual(query.where, { aplicativoId, habilidadeId, habilidade: { arquivada: false } });
      assert.deepEqual(query.orderBy, { numero: "desc" });
      return disponivel ? { id: versaoId } : null;
    } },
  };
  Object.assign(globalThis, { prisma: {
    usuario: { findUnique: async () => usuario },
    $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
  } });
  t.after(() => { Reflect.deleteProperty(globalThis, "prisma"); });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ error: null, data: { user: { id: randomUUID() } } }));
  const { POST } = await import("../src/app/api/automatizacao/[recurso]/route");
  const executar = () => POST(new Request(`https://erp.test/api/automatizacao/testar-rotina?id=${rotinaId}`, {
    method: "POST", headers: { Authorization: "Bearer ficticio" },
  }), { params: Promise.resolve({ recurso: "testar-rotina" }) });
  const primeira = await executar();
  assert.equal(primeira.status, 200);
  const resposta = await primeira.json();
  assert.deepEqual(await (await executar()).json(), resposta);
  assert.equal(criadas, 1);
  existente = { id: resposta.id, status: "FALHA_FINAL" };
  assert.equal((await executar()).status, 409);
  assert.equal(criadas, 1);
  existente = null;
  disponivel = false;
  assert.equal((await executar()).status, 409);
  encontrada = false;
  assert.equal((await executar()).status, 404);
  const antes = locks;
  usuario.podeIntervirAutomatizacao = false;
  assert.equal((await executar()).status, 403);
  assert.equal(locks, antes);
});
