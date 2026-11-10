import assert from "node:assert/strict";
import { test } from "node:test";
import { eventoWorker } from "@/lib/automatizacao/log-worker";

test("log identifica a rotina e a etapa sem carregar o conteúdo da execução", () => {
  const inicio = Date.now() - 10_000;
  const evento = JSON.parse(eventoWorker("EXECUTANDO", "Minha rotina\n\u001b[31m", inicio));
  assert.equal(evento.etapa, "EXECUTANDO");
  assert.doesNotMatch(evento.rotina, /[\u0000-\u001f]/);
  assert.ok(evento.duracaoMs >= 10_000);
  assert.deepEqual(Object.keys(evento).sort(), ["duracaoMs", "etapa", "horario", "rotina"]);
  assert.ok(!Number.isNaN(Date.parse(evento.horario)));
});

test("log ocioso é curto e encerramento inclui desfecho", () => {
  assert.equal(JSON.parse(eventoWorker("AGUARDANDO_TAREFA")).rotina, undefined);
  assert.equal(JSON.parse(eventoWorker("FINALIZADA", "Rotina", Date.now(), "SUCESSO")).desfecho, "SUCESSO");
  assert.equal(JSON.parse(eventoWorker("EXECUTANDO", "x".repeat(300))).rotina.length, 120);
});
