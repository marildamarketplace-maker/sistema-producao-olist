import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { conflitoHorarios } from "../src/lib/automatizacao/conflito-horarios";
import { revisaoRotina } from "../src/lib/automatizacao/revisao-rotina";

const horario = (dia: number, hora: string) => ({ dia, hora });
test("bloqueia coincidência e 14 minutos antes/depois; aceita exatamente 15", () => {
  const outras = [{ nome: "Chats", horarios: [horario(1, "08:00")] }];
  for (const hora of ["07:46", "08:00", "08:14"]) {
    assert.match(conflitoHorarios([horario(1, hora)], outras)!, /Chats.*Segunda 08:00/);
  }
  for (const hora of ["07:45", "08:15"]) assert.equal(conflitoHorarios([horario(1, hora)], outras), null);
  assert.equal(conflitoHorarios([horario(2, "08:00")], outras), null);
});
test("verifica horários internos, meia-noite e virada da semana", () => {
  assert.match(conflitoHorarios([horario(2, "08:00"), horario(2, "08:14")], [])!, /própria rotina/);
  for (const dia of [0, 2]) {
    const anterior = (dia + 6) % 7;
    assert.ok(conflitoHorarios([horario(dia, "00:05")], [{ nome: "Anterior", horarios: [horario(anterior, "23:55")] }]));
    assert.equal(conflitoHorarios([horario(dia, "00:10")], [{ nome: "Anterior", horarios: [horario(anterior, "23:55")] }]), null);
  }
});

test("API bloqueia criação, edição e ativação; preserva pausa, autorização e isolamento", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticia";
  const aplicativoId = randomUUID(), id = randomUUID(), habilidadeId = randomUUID();
  const usuario = { ativo: true, aplicativoId, podeVisualizarAutomatizacao: true, podeGerenciarRotinas: true };
  const atual = { nome: "Teste", habilidadeId, ativa: false, horarios: [horario(1, "08:00")] };
  let gravadas = 0, locks = 0;
  let outras = [{ nome: "Chats", horarios: [horario(1, "08:00")] }];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (sql.join("").includes("pg_advisory_xact_lock")) {
        assert.deepEqual(values, [`automatizacao-horarios:${aplicativoId}`]); locks++; return [];
      }
      assert.equal(locks > 0, true);
      return sql.join("").includes("automatizacao_habilidade") ? [{ id: habilidadeId }] : [atual];
    },
    rotinaAutomatizacao: {
      findFirst: async () => atual,
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.aplicativoId, aplicativoId);
        assert.equal(where.ativa, true);
        assert.equal(where.arquivada, false);
        if (where.id) assert.deepEqual(where.id, { not: id });
        return outras;
      },
      create: async () => { gravadas++; }, updateMany: async () => { gravadas++; },
    },
  };
  Object.assign(globalThis, { prisma: {
    usuario: { findUnique: async () => usuario },
    $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
  } });
  t.after(() => Reflect.deleteProperty(globalThis, "prisma"));
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ error: null, data: { user: { id: randomUUID() } } }));
  const { POST, PATCH } = await import("../src/app/api/automatizacao/[recurso]/route");
  const chamar = (method: string, body: object, busca = "") => (method === "POST" ? POST : PATCH)(new Request(`https://erp.test/api/automatizacao/rotinas${busca}`, {
    method, headers: { Authorization: "Bearer ficticio", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ recurso: "rotinas" }) });
  const dados = { ...atual, revisao: revisaoRotina(atual) };
  assert.equal((await chamar("POST", dados)).status, 409);
  assert.equal((await chamar("PATCH", dados, `?id=${id}`)).status, 409);
  assert.equal((await chamar("PATCH", { ativa: true, revisao: dados.revisao }, `?id=${id}&acao=status`)).status, 409);
  assert.equal(gravadas, 0);
  assert.equal((await chamar("PATCH", { ativa: false, revisao: dados.revisao }, `?id=${id}&acao=status`)).status, 200);
  assert.equal((await chamar("POST", { ...dados, horarios: [horario(1, "08:15")] })).status, 200);
  assert.equal((await chamar("POST", { ...dados, horarios: [{ diaMes: 1, hora: "08:14" }] })).status, 409);
  assert.equal((await chamar("POST", { ...dados, horarios: [{ diaMes: 1, hora: "11:00" }] })).status, 200);
  assert.equal((await chamar("PATCH", { ...dados, horarios: [{ diaMes: 1, hora: "11:00" }] }, `?id=${id}`)).status, 200);
  assert.equal((await chamar("POST", { ...dados, horarios: [{ diaMes: 32, hora: "11:00" }] })).status, 400);
  outras = [];
  assert.equal((await chamar("POST", { ...dados, horarios: [horario(1, "08:00"), horario(1, "08:10")] })).status, 409);
  assert.equal((await chamar("POST", dados)).status, 200);
  usuario.podeGerenciarRotinas = false;
  const antes = locks;
  assert.equal((await chamar("POST", dados)).status, 403);
  assert.equal(locks, antes);
});
