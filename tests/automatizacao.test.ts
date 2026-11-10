import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { calcularDisparos } from "../src/lib/automatizacao/calendario";
import { horariosSchema, habilidadeSchema, rotinaSchema } from "../src/lib/automatizacao/contrato";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";

test("prioriza o último horário de São Paulo na janela de recuperação", () => {
  const resultado = calcularDisparos(
    [{ dia: 1, hora: "08:00" }, { dia: 1, hora: "08:05" }, { dia: 1, hora: "07:00" }],
    new Date("2026-11-09T09:00:00Z"),
    new Date("2026-11-09T11:10:00Z"),
  );
  assert.equal(resultado.elegivel?.toISOString(), "2026-11-09T11:05:00.000Z");
  assert.deepEqual(resultado.ignorados.map((data) => data.toISOString()), ["2026-11-09T11:00:00.000Z"]);
  assert.ok(resultado.atrasoAgregado);
});

test("usa o dia de São Paulo quando a data UTC já virou e respeita o cursor", () => {
  const horario = [{ dia: 0, hora: "22:01" }];
  const agora = new Date("2026-11-09T01:01:00Z");
  assert.deepEqual(calcularDisparos(horario, new Date("2026-11-09T01:00:00Z"), agora).elegivel, agora);
  assert.equal(calcularDisparos(horario, agora, agora).elegivel, null);
});

test("recusa horários inválidos e repetidos e inicia rotinas pausadas", () => {
  assert.equal(horariosSchema.safeParse([{ dia: 2, hora: "24:00" }]).success, false);
  assert.equal(horariosSchema.safeParse([{ dia: 2, hora: "08:00" }, { dia: 2, hora: "08:00" }]).success, false);
  assert.equal(habilidadeSchema.safeParse({ nome: "Teste", markdown: " " }).success, false);
  assert.equal(rotinaSchema.parse({
    nome: "Teste", habilidadeId: "00000000-0000-4000-8000-000000000001",
    horarios: [{ dia: 2, hora: "08:00" }],
  }).ativa, false);
});

test("migration isola o aplicativo e bloqueia próxima ocorrência até sucesso", async (t) => {
  const db = criarPostgresMemoria();
  t.after(() => db.close());
  const app = "00000000-0000-4000-8000-000000000001";
  const outroApp = "00000000-0000-4000-8000-000000000002";
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE TABLE usuario (id uuid PRIMARY KEY);
    CREATE TABLE notification (id uuid PRIMARY KEY);
    CREATE TABLE aplicativo (id uuid PRIMARY KEY);
  `);
  await db.exec(await readFile("prisma/migrations/20261110120000_automatizacao/migration.sql", "utf8"));
  await db.query("INSERT INTO aplicativo (id) VALUES ($1), ($2)", [app, outroApp]);
  const habilidade = (await db.query<{ id: string }>(
    'INSERT INTO automatizacao_habilidade ("aplicativoId", nome) VALUES ($1, $2) RETURNING id', [app, "Piloto"],
  )).rows[0].id;
  const versao = (await db.query<{ id: string }>(
    'INSERT INTO automatizacao_habilidade_versao ("aplicativoId", "habilidadeId", numero, markdown) VALUES ($1, $2, 1, $3) RETURNING id',
    [app, habilidade, "Prompt de teste"],
  )).rows[0].id;
  const inserirRotina = 'INSERT INTO automatizacao_rotina ("aplicativoId", "habilidadeId", nome, horarios) VALUES ($1, $2, $3, $4) RETURNING id';
  await assert.rejects(db.query(inserirRotina, [outroApp, habilidade, "Invasão", "[]"]), { code: "23503" });
  const rotina = (await db.query<{ id: string }>(inserirRotina, [app, habilidade, "Piloto", "[]"])).rows[0].id;
  const inserir = (data: string) => db.query(
    'INSERT INTO automatizacao_execucao ("aplicativoId", "rotinaId", "versaoId", "previstoEm") VALUES ($1, $2, $3, $4)',
    [app, rotina, versao, data],
  );
  await inserir("2026-11-09T11:00:00Z");
  await db.exec("UPDATE automatizacao_execucao SET status = 'FALHA_FINAL'");
  await assert.rejects(inserir("2026-11-10T11:00:00Z"), { code: "23505" });
  await db.exec("UPDATE automatizacao_execucao SET status = 'CONCLUIDA'");
  await assert.rejects(inserir("2026-11-09T11:00:00Z"), { code: "23505" });
  await inserir("2026-11-10T11:00:00Z");
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.query("SELECT * FROM automatizacao_execucao"), { code: "42501" });
});

test("renova depois de falha de transporte sem abandonar a execução", async () => {
  const { renovarEnquantoValida } = await import("../src/lib/automatizacao/renovacao");
  const fim = new AbortController();
  let agora = 0;
  const chamadas: number[] = [];
  const valida = await renovarEnquantoValida({
    iniciadaEm: 0,
    agora: () => agora,
    esperar: async (ms) => { agora += ms; },
    renovar: async () => {
      chamadas.push(agora);
      if (chamadas.length === 1) throw new Error("Timeout");
      fim.abort();
      return true;
    },
    signal: fim.signal,
  });
  assert.equal(valida, true);
  assert.deepEqual(chamadas, [15_000, 17_000]);
});

test("interrompe ao perder a reserva ou esgotar seu prazo, mesmo com timeout de transporte", async () => {
  const { renovarEnquantoValida, prazoReservaMs } = await import("../src/lib/automatizacao/renovacao");
  for (const rejeitada of [true, false]) {
    let agora = 0;
    const valida = await renovarEnquantoValida({
      iniciadaEm: 0,
      agora: () => agora,
      esperar: async (ms) => { agora += ms; },
      renovar: async (timeout) => {
        if (rejeitada) return false;
        agora += timeout;
        throw new Error("Timeout");
      },
      signal: new AbortController().signal,
    });
    assert.equal(valida, false);
    assert.equal(agora, rejeitada ? 15_000 : prazoReservaMs);
  }
});

test("a revisão da rotina detecta pausa e edição sem depender do cursor do agendador", async () => {
  const { revisaoRotina } = await import("../src/lib/automatizacao/revisao-rotina");
  const rotina = { nome: "Piloto", habilidadeId: "habilidade", ativa: true, horarios: [{ dia: 2, hora: "08:00" }] };
  const comCursor = { ...rotina, cursor: new Date() };
  assert.equal(revisaoRotina(comCursor), revisaoRotina(rotina));
  assert.notEqual(revisaoRotina({ ...rotina, ativa: false }), revisaoRotina(rotina));
  assert.notEqual(revisaoRotina({ ...rotina, nome: "Novo nome" }), revisaoRotina(rotina));
});
