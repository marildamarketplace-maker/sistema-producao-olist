import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("disparo manual executa habilidade real com bloqueio e autorização", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticia";
  const aplicativoId = randomUUID(), rotinaId = randomUUID(), habilidadeId = randomUUID(), versaoId = randomUUID();
  const usuario = { ativo: true, aplicativoId, podeVisualizarAutomatizacao: true, podeIntervirAutomatizacao: true };
  let encontrada = true, disponivel = true, criadas = 0, locks = 0, conflito = false;
  let existente: { id: string; status: string } | null = null;
  const atualizacoes: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: async (_sql: TemplateStringsArray, ...values: string[]) => {
      locks++;
      assert.deepEqual(values, [rotinaId, aplicativoId]);
      return encontrada ? [{ habilidadeId }] : [];
    },
    execucaoAutomatizacao: {
      updateMany: async ({ where, data }: { where: { id: string; aplicativoId: string }; data: Record<string, unknown> }) => {
        assert.equal(where.id, existente?.id);
        assert.equal(where.aplicativoId, aplicativoId);
        assert.ok(data.disponivelEm instanceof Date);
        assert.ok(!("versaoId" in data));
        atualizacoes.push(data);
        if (data.status) existente!.status = String(data.status);
        return { count: 1 };
      },
      findFirst: async ({ where }: { where: unknown }) => {
        const filtro = where as { status: { notIn?: string[] } };
        assert.deepEqual(where, { aplicativoId, rotinaId, tipo: { not: "TESTE_ROTINA" }, status: filtro.status.notIn ? { notIn: ["CONCLUIDA", "FALHA_FINAL"] } : { not: "CONCLUIDA" } });
        return filtro.status.notIn?.includes(existente?.status ?? "") ? null : existente;
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
    $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => {
      if (conflito) throw { code: "P2002" };
      return fn(tx);
    },
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
  assert.equal(resposta.situacao, "CRIADA");
  assert.deepEqual(await (await executar()).json(), { id: resposta.id, situacao: "NA_FILA" });
  assert.equal(criadas, 1);
  existente = { id: resposta.id, status: "FALHA_FINAL" };
  assert.deepEqual(await (await executar()).json(), { id: resposta.id, situacao: "REENFILEIRADA" });
  assert.deepEqual(atualizacoes.at(-1)?.rodada, { increment: 1 });
  assert.equal(atualizacoes.at(-1)?.tentativa, 0);
  assert.equal(existente.status, "PENDENTE");
  existente.status = "BLOQUEADA";
  assert.deepEqual(await (await executar()).json(), { id: resposta.id, situacao: "REENFILEIRADA" });
  assert.equal(existente.status, "PENDENTE");
  existente.status = "AGUARDANDO_RETRY";
  assert.deepEqual(await (await executar()).json(), { id: resposta.id, situacao: "NA_FILA" });
  existente.status = "EM_EXECUCAO";
  const alteradas = atualizacoes.length;
  assert.deepEqual(await (await executar()).json(), { id: resposta.id, situacao: "EM_EXECUCAO" });
  assert.equal(atualizacoes.length, alteradas);
  assert.equal(criadas, 1);
  // Concluir uma execução no mesmo dia não impede uma nova solicitação manual.
  existente = null;
  assert.equal((await (await executar()).json()).situacao, "CRIADA");
  assert.equal(criadas, 2);
  existente = null;
  disponivel = false;
  assert.equal((await executar()).status, 409);
  conflito = true;
  assert.equal((await executar()).status, 409);
  conflito = false;
  encontrada = false;
  assert.equal((await executar()).status, 404);
  const antes = locks;
  usuario.podeIntervirAutomatizacao = false;
  assert.equal((await executar()).status, 403);
  assert.equal(locks, antes);
});
