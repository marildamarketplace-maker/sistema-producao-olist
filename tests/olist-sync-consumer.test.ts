import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ClienteSync } from "../src/lib/olist-sync/contrato";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";

// Simula somente a fronteira de reserva vazia. O relógio avança durante o I/O,
// além das esperas explícitas; o transporte remoto nunca deve ser chamado.
function consumidor(janelas: Array<{ em: number; latencia?: number }>, prazo = 240_000) {
  let agora = Date.now(), reservas = 0, consultas = 0;
  const inicio = agora, esperas: number[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      if (String(sql).includes("SELECT c.id FROM olist_sync_configuracao")) reservas++;
      return [];
    },
  };
  const db = {
    $transaction: async (executar: (atual: typeof tx) => Promise<unknown>) => executar(tx),
    olistSyncConfiguracao: { findMany: async () => [] },
    olistSyncExecucao: { findMany: async () => [] },
    $queryRaw: async (sql: TemplateStringsArray) => {
      assert.match(String(sql), /greatest\(s.disponivel_em/);
      const janela = janelas[consultas++];
      if (!janela) return [];
      const disponivel = new Date(agora + janela.em);
      agora += janela.latencia ?? 0;
      return [{ disponivel }];
    },
  } as unknown as PrismaClient;
  const inesperado = async () => { throw new Error("Nenhuma chamada remota era esperada"); };
  const cliente: ClienteSync = {
    listar: inesperado, detalhar: inesperado, buscarPorChave: inesperado,
    identidadeConta: inesperado, criar: inesperado, atualizar: inesperado,
  };
  const servico = criarServicoOlistSync(db, cliente, {
    agora: () => new Date(agora), aguardar: async ms => { esperas.push(ms); agora += ms; },
  });
  return {
    executar: () => servico.executar(inicio + prazo),
    resultado: () => ({ reservas, consultas, esperas, decorrido: agora - inicio }),
  };
}

for (const em of [-1, 0, 50]) test(`consumidor tenta reservar novamente quando a janela ${em}ms já venceu durante o banco`, async () => {
  const c = consumidor([{ em, latencia: 100 }]);
  assert.deepEqual(await c.executar(), { agendadas: 0, etapas: 0 });
  assert.deepEqual(c.resultado(), { reservas: 2, consultas: 2, esperas: [100], decorrido: 200 });
});

test("contenção persistente com trabalho pronto encerra após tentativas limitadas", async () => {
  const c = consumidor(Array.from({ length: 20 }, () => ({ em: 0 })));
  await c.executar();
  assert.deepEqual(c.resultado(), { reservas: 4, consultas: 4, esperas: [100, 100, 100], decorrido: 300 });
});

test("janela futura desconta latência da consulta e retoma depois da espera", async () => {
  const c = consumidor([{ em: 2_000, latencia: 100 }]);
  await c.executar();
  assert.deepEqual(c.resultado(), { reservas: 2, consultas: 2, esperas: [1_900], decorrido: 2_000 });
});

test("fila vazia não mantém polling", async () => {
  const c = consumidor([]);
  await c.executar();
  assert.deepEqual(c.resultado(), { reservas: 1, consultas: 1, esperas: [], decorrido: 0 });
});

for (const janela of [{ em: 13_000 }, { em: 0, latencia: 120_000 }, { em: 0, latencia: 50 }]) {
  test(`consumidor preserva orçamento e limite da espera: ${JSON.stringify(janela)}`, async () => {
    const c = consumidor([janela], janela.latencia === 50 ? 120_100 : 240_000);
    await c.executar();
    assert.equal(c.resultado().reservas, 1);
    assert.deepEqual(c.resultado().esperas, []);
  });
}
