import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

test("worker rejeita reserva vencida e deduplica cada fechamento", async (t) => {
  // ID legado usado em produção: aceito pelo Postgres, sem versão RFC.
  const aplicativoId = "00000000-0000-0000-0000-000000000001";
  const id = randomUUID();
  const token = "credencial-ficticia";
  const escopo = { id: "piloto", aplicativoId, tokenSha256: createHash("sha256").update(token).digest("hex") };
  process.env.AUTOMATIZACAO_WORKERS = JSON.stringify([escopo]);

  const execucao = {
    id, aplicativoId, status: "PENDENTE", tipo: "EXECUTAR_PROMPT", tentativa: 0, rodada: 1,
    rotinaId: randomUUID(), reserva: null as string | null, reservaAte: null as Date | null,
    versao: { markdown: "# Entrada imutável" },
  };
  type Tentativa = { id: string; worker: string; status: string; resultado?: string; encerradaEm?: Date };
  const tentativas = new Map<string, Tentativa>();
  const avisos: string[] = [];
  const notificacoes: string[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, ...valores: string[]) => {
      if (sql.join("").includes("JOIN")) {
        const [reserva, worker, app] = valores;
        return tentativas.get(reserva)?.worker === worker && app === aplicativoId ? [{ id }] : [];
      }
      return valores[0] === aplicativoId ? [{ id }] : [];
    },
    execucaoAutomatizacao: {
      findUniqueOrThrow: async () => ({ ...execucao }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        const tentativa = data.tentativa as { increment?: number; decrement?: number } | undefined;
        Object.assign(execucao, { ...data, tentativa: execucao.tentativa + (tentativa?.increment ?? 0) - (tentativa?.decrement ?? 0) });
      },
    },
    tentativaAutomatizacao: {
      create: async ({ data }: { data: Tentativa }) => tentativas.set(data.id, { ...data, status: "EM_EXECUCAO" }),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => tentativas.get(where.id),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Tentativa> }) => Object.assign(tentativas.get(where.id)!, data),
    },
    aplicativo: { findUnique: async () => ({ whatsapp: "5531999999999" }) },
    rotinaAutomatizacao: { findUniqueOrThrow: async () => ({ nome: "Piloto" }) },
    notification: { create: async ({ data }: { data: { mensagem: string } }) => {
      notificacoes.push(data.mensagem);
      return { id: randomUUID() };
    } },
    avisoAutomatizacao: { create: async ({ data }: { data: { tentativaId: string } }) => avisos.push(data.tentativaId) },
  };
  Object.assign(globalThis, { prisma: { $transaction: async (callback: (banco: typeof tx) => Promise<unknown>) => callback(tx) } });
  t.after(() => { delete process.env.AUTOMATIZACAO_WORKERS; Reflect.deleteProperty(globalThis, "prisma"); });
  const { POST } = await import("../src/app/api/interno/automatizacao/route");
  const operar = (corpo: object, credencial = token) => POST(new Request("https://erp.test/api/interno/automatizacao", {
    method: "POST", headers: { Authorization: `Bearer ${credencial}` }, body: JSON.stringify(corpo),
  }));
  const reservar = async () => (await (await operar({ acao: "reservar" })).json()).trabalho as { reserva: string; markdown: string };
  const finalizar = (reserva: string, desfecho: string, resultado = "resultado") => operar({ acao: "finalizar", reserva, desfecho, resultado });

  assert.equal((await operar({ acao: "reservar" }, "outra-credencial")).status, 401);
  assert.equal((await operar({ acao: "diagnostico" })).status, 400);
  process.env.AUTOMATIZACAO_WORKERS = JSON.stringify([{ ...escopo, aplicativoId: "invalido" }]);
  assert.equal((await operar({ acao: "diagnostico" })).status, 500);
  process.env.AUTOMATIZACAO_WORKERS = JSON.stringify([escopo]);
  const primeira = await reservar();
  assert.equal(primeira.markdown, "# Entrada imutável");
  execucao.reservaAte = new Date(0);
  assert.equal((await finalizar(primeira.reserva, "SUCESSO")).status, 409);
  const segunda = await reservar();
  assert.equal(tentativas.get(primeira.reserva)?.status, "RESERVA_EXPIRADA");
  assert.equal((await finalizar(primeira.reserva, "SUCESSO")).status, 409);
  assert.equal((await operar({ acao: "renovar", reserva: segunda.reserva })).status, 200);
  assert.deepEqual(await (await finalizar(segunda.reserva, "FALHA")).json(), { status: "FALHA_FINAL" });
  assert.deepEqual(await (await finalizar(segunda.reserva, "FALHA")).json(), { status: "FALHA_FINAL" });

  Object.assign(execucao, { status: "PENDENTE", tentativa: 0, rodada: 2 });
  const terceira = await reservar();
  assert.deepEqual(await (await finalizar(terceira.reserva, "SUCESSO")).json(), { status: "CONCLUIDA" });
  assert.deepEqual(avisos, [segunda.reserva, terceira.reserva]);
  assert.match(notificacoes[0], /Não foi possível confirmar/);
  assert.match(notificacoes[1], /concluída com sucesso/);
  assert.ok(notificacoes.every((mensagem) => !mensagem.includes(execucao.id)));

  Object.assign(execucao, { tipo: "TESTE_ROTINA", status: "PENDENTE", tentativa: 0 });
  const teste = await reservar();
  assert.match(teste.markdown, /TESTE_ROTINA_OK/);
  assert.doesNotMatch(teste.markdown, /Entrada imutável/);
  assert.deepEqual(await (await finalizar(teste.reserva, "SUCESSO", "TESTE_ROTINA_OK")).json(), { status: "CONCLUIDA" });
  assert.equal(notificacoes.length, 2);
});
