import assert from "node:assert/strict";
import { test } from "node:test";

test("agendador libera falhas anteriores e preserva bloqueios e exclusão por rotina", async (t) => {
  const rotinaId = "rotina", aplicativoId = "app";
  let anterior = "FALHA_FINAL", lida = false;
  const criadas: unknown[] = [], disparos: { motivo: string }[] = [];
  const tx = {
    $queryRaw: async () => lida ? [] : (lida = true, [{ id: rotinaId }]),
    rotinaAutomatizacao: {
      findUniqueOrThrow: async () => {
        const agora = new Date();
        return { id: rotinaId, aplicativoId, cursor: new Date(agora.getTime() - 60_000),
          horarios: [{ dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(agora)),
            hora: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora) }],
          habilidade: { versoes: [{ id: "versao" }] } };
      },
      update: async () => {},
    },
    execucaoAutomatizacao: {
      findFirst: async ({ where }: { where: { status: { notIn: string[] } } }) => {
        assert.deepEqual(where, { aplicativoId, rotinaId, tipo: { not: "TESTE_ROTINA" }, status: { notIn: ["CONCLUIDA", "FALHA_FINAL"] } });
        return where.status.notIn.includes(anterior) ? null : { status: anterior };
      },
      create: async ({ data }: { data: unknown }) => criadas.push(data),
    },
    disparoAutomatizacao: { createMany: async ({ data }: { data: { motivo: string }[] }) => disparos.push(...data) },
  };
  Object.assign(globalThis, { prisma: { $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx) } });
  t.after(() => Reflect.deleteProperty(globalThis, "prisma"));
  const { agendarAutomatizacoes } = await import("../src/lib/automatizacao/agendador");
  for (const status of ["FALHA_FINAL", "CONCLUIDA", "PENDENTE", "AGUARDANDO_RETRY", "EM_EXECUCAO", "BLOQUEADA"]) {
    anterior = status; lida = false; criadas.length = 0; disparos.length = 0;
    assert.equal(await agendarAutomatizacoes(), 1);
    const liberada = ["FALHA_FINAL", "CONCLUIDA"].includes(status);
    assert.equal(criadas.length, liberada ? 1 : 0);
    assert.equal(disparos[0].motivo, liberada ? "ENFILEIRADO" : "SOBREPOSICAO");
  }
});
