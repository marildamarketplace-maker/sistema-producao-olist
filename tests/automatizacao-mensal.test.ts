import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularDisparos } from "../src/lib/automatizacao/calendario";
import { horariosSchema } from "../src/lib/automatizacao/contrato";
import { conflitoHorarios } from "../src/lib/automatizacao/conflito-horarios";

test("agenda mensal exige dia válido, sem ambiguidade com dia da semana", () => {
  for (const diaMes of [1, 28, 29, 30, 31]) {
    assert.equal(horariosSchema.safeParse([{ diaMes, hora: "11:00" }]).success, true);
  }
  for (const horario of [
    { diaMes: 0, hora: "11:00" }, { diaMes: 32, hora: "11:00" },
    { diaMes: 1.5, hora: "11:00" }, { diaMes: "1", hora: "11:00" },
    { diaMes: 1, dia: 1, hora: "11:00" }, { hora: "11:00" },
    { diaMes: 1, hora: "24:00" },
  ]) assert.equal(horariosSchema.safeParse([horario]).success, false);
  assert.equal(horariosSchema.safeParse([{ diaMes: 1, hora: "11:00" }, { diaMes: 1, hora: "11:00" }]).success, false);
  assert.equal(horariosSchema.safeParse([{ diaMes: 1, hora: "11:00" }, { dia: 1, hora: "11:00" }]).success, true);
});

function disparo(diaMes: number, data: string, hora = "11:00") {
  const agora = new Date(data);
  return calcularDisparos([{ diaMes, hora }], new Date(agora.getTime() - 60_000), agora).elegivel;
}

test("dia 1 dispara uma vez no horário de São Paulo, sem virar execução semanal", () => {
  const agora = new Date("2026-12-01T14:00:00Z");
  assert.deepEqual(disparo(1, agora.toISOString()), agora);
  assert.equal(disparo(1, "2026-12-08T14:00:00Z"), null);
  assert.equal(disparo(1, "2026-12-02T14:00:00Z"), null);
  assert.equal(disparo(1, "2026-12-01T13:59:00Z"), null);
  assert.equal(calcularDisparos([{ diaMes: 1, hora: "11:00" }], agora, agora).elegivel, null);
  assert.deepEqual(calcularDisparos([{ diaMes: 1, hora: "11:00" }], new Date("2026-12-01T13:59:00Z"), new Date("2026-12-01T14:10:00Z")).elegivel, agora);
});

test("mês local, virada do ano e dias inexistentes respeitam o calendário", () => {
  assert.equal(disparo(1, "2026-12-01T02:59:00Z", "23:59"), null);
  assert.deepEqual(disparo(30, "2026-12-01T02:59:00Z", "23:59"), new Date("2026-12-01T02:59:00Z"));
  assert.deepEqual(disparo(1, "2027-01-01T03:00:00Z", "00:00"), new Date("2027-01-01T03:00:00Z"));
  assert.equal(disparo(31, "2027-04-30T14:00:00Z"), null);
  assert.equal(disparo(29, "2027-02-28T14:00:00Z"), null);
  assert.deepEqual(disparo(29, "2028-02-29T14:00:00Z"), new Date("2028-02-29T14:00:00Z"));
});

test("conflitos mensais preservam intervalo de 15 minutos e viradas de mês", () => {
  const outras = [{ nome: "Mensal", horarios: [{ diaMes: 1, hora: "11:00" }] }];
  assert.ok(conflitoHorarios([{ diaMes: 1, hora: "10:46" }], outras));
  assert.equal(conflitoHorarios([{ diaMes: 1, hora: "10:45" }], outras), null);
  assert.equal(conflitoHorarios([{ diaMes: 2, hora: "11:00" }], outras), null);
  for (const diaMes of [28, 29, 30, 31]) {
    assert.ok(conflitoHorarios([{ diaMes, hora: "23:55" }, { diaMes: 1, hora: "00:05" }], []));
    assert.equal(conflitoHorarios([{ diaMes, hora: "23:55" }, { diaMes: 1, hora: "00:10" }], []), null);
  }
});

test("agenda mensal verifica conflitos com qualquer dia semanal, inclusive meia-noite", () => {
  for (let dia = 0; dia < 7; dia++) {
    const outras = [{ nome: "Semanal", horarios: [{ dia, hora: "11:00" }] }];
    assert.ok(conflitoHorarios([{ diaMes: 1, hora: "11:14" }], outras));
    assert.equal(conflitoHorarios([{ diaMes: 1, hora: "11:15" }], outras), null);
    assert.ok(conflitoHorarios([{ diaMes: 1, hora: "00:05" }], [{ nome: "Virada", horarios: [{ dia, hora: "23:55" }] }]));
    assert.ok(conflitoHorarios([{ dia, hora: "11:14" }], [{ nome: "Mensal", horarios: [{ diaMes: 1, hora: "11:00" }] }]));
  }
});
