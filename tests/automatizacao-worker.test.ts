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
    rotina: { nome: "Piloto" },
  };
  const inicioTentativa = new Date("2026-11-11T01:15:00Z");
  type Tentativa = { iniciadaEm: Date; id: string; worker: string; status: string; resultado?: string; encerradaEm?: Date };
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
      create: async ({ data }: { data: Tentativa }) => tentativas.set(data.id, { ...data, iniciadaEm: inicioTentativa, status: "EM_EXECUCAO" }),
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
  const reservar = async () => (await (await operar({ acao: "reservar" })).json()).trabalho as { reserva: string; markdown: string; rotinaNome: string };
  const finalizar = (reserva: string, desfecho: string, resultado = "resultado") => operar({ acao: "finalizar", reserva, desfecho, resultado });

  assert.equal((await operar({ acao: "reservar" }, "outra-credencial")).status, 401);
  assert.equal((await operar({ acao: "diagnostico" })).status, 400);
  process.env.AUTOMATIZACAO_WORKERS = JSON.stringify([{ ...escopo, aplicativoId: "invalido" }]);
  assert.equal((await operar({ acao: "diagnostico" })).status, 500);
  process.env.AUTOMATIZACAO_WORKERS = JSON.stringify([escopo]);
  const primeira = await reservar();
  assert.equal(primeira.markdown, "# Entrada imutável");
  assert.equal(primeira.rotinaNome, "Piloto");
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
  assert.match(notificacoes[0], /Resultado: resultado/);
  assert.match(notificacoes[0], /Execução: 10\/11\/2026, 22:15/);
  assert.match(notificacoes[1], /Resultado: resultado/);
  assert.ok(notificacoes.every((mensagem) => !mensagem.includes(execucao.id)));

  Object.assign(execucao, { status: "PENDENTE", tentativa: 0, rodada: 3 });
  const bloqueada = await reservar();
  const parcial = "Shopee: análise parcial; CAPTCHA. TikTok: fila vazia.";
  assert.deepEqual(await (await finalizar(bloqueada.reserva, "BLOQUEADA", parcial)).json(), { status: "BLOQUEADA" });
  assert.equal(execucao.status, "BLOQUEADA");
  assert.equal(execucao.reserva, null);
  assert.equal(tentativas.get(bloqueada.reserva)?.resultado, parcial);
  assert.equal(avisos.at(-1), bloqueada.reserva);
  assert.ok(notificacoes.at(-1)?.endsWith(parcial));
  assert.deepEqual(await (await finalizar(bloqueada.reserva, "BLOQUEADA", parcial)).json(), { status: "BLOQUEADA" });
  assert.equal(notificacoes.length, 3);

  Object.assign(execucao, { status: "PENDENTE", tentativa: 0, rodada: 4 });
  const comImagem = await reservar();
  const evidencia = { media: Buffer.from([255, 216, 255, 217]).toString("base64"), mimetype: "image/jpeg" };
  const fechamentoImagem = { acao: "finalizar", reserva: comImagem.reserva, desfecho: "SUCESSO", resultado: "feito", evidencia };
  assert.equal((await operar(fechamentoImagem)).status, 200);
  assert.equal((await operar(fechamentoImagem)).status, 200);
  assert.equal(notificacoes.length, 4);
  const envelope = JSON.parse(notificacoes.at(-1)!.slice("whatsapp:image:v1\n".length));
  assert.equal(envelope.media, evidencia.media);
  assert.match(envelope.caption, /Resultado: feito/);
  assert.equal(tentativas.get(comImagem.reserva)?.resultado, "feito");

  Object.assign(execucao, { tipo: "TESTE_ROTINA", status: "PENDENTE", tentativa: 0 });
  const teste = await reservar();
  assert.match(teste.markdown, /TESTE_ROTINA_OK/);
  assert.doesNotMatch(teste.markdown, /Entrada imutável/);
  assert.deepEqual(await (await finalizar(teste.reserva, "SUCESSO", "TESTE_ROTINA_OK")).json(), { status: "CONCLUIDA" });
  assert.equal(notificacoes.length, 4);
});
