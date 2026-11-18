import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { aplicarMigrationsOlistSync } from "./fixtures/olist-sync-migrations";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { criarOlistSyncRepository } from "../src/repositories/olist-sync-repository";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";
import { assinaturaEscopoSync, VERSAO_CONTRATO_INCREMENTAL } from "../src/lib/olist-sync/incremental";
import type { ClienteSync } from "../src/lib/olist-sync/contrato";

const url = process.env.OLIST_SYNC_CONCURRENCY_TEST_DATABASE_URL;

test("Olist sync: concorrência real na conclusão de fases e cancelamento", { skip: !url, timeout: 30_000 }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));
  assert.match(endereco.pathname, /^\/olist_sync_test_concurrency(?:_[a-z0-9]+)?$/);
  const sql = new Client({ connectionString: url! });
  await sql.connect(); t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) });
  t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int total FROM pg_tables WHERE schemaname='public'")).rows[0].total, 0, "Exige banco local vazio.");
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
  const pai = "00000000-0000-0000-0000-000000000002";
  const a = "00000000-0000-0000-0000-000000000004", b = "00000000-0000-0000-0000-000000000005", usuario = randomUUID();
  await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Pai')", [pai]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$3),($2,'B',$3)", [a, b, pai]);
  await aplicarMigrationsOlistSync(sql);
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true)", [usuario, pai]);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai);
  assert.ok(config);
  await db.configuracaoJob.updateMany({ data: { pausado: false } });
  await db.olistSyncConfiguracao.update({ where: { id: config.id }, data: { ativo: true, autorizadoPor: usuario, entidades: ["PRODUTO"] } });
  const inesperado = async () => { assert.fail("Encerrar DETALHAR vazio não pode consultar nem alterar a Olist."); };
  const cliente: ClienteSync = { listar: inesperado, detalhar: inesperado, buscarPorChave: inesperado, identidadeConta: inesperado, criar: inesperado, atualizar: inesperado };
  const servico = criarServicoOlistSync(db, cliente);
  async function reset() {
    await sql.query("TRUNCATE olist_sync_registro,olist_sync_execucao CASCADE");
    await db.olistSyncParticipante.updateMany({ data: { proximaChamadaEm: null } });
  }
  t.beforeEach(reset);
  t.afterEach(reset);
  const enfileirar = (chave = randomUUID()) => repo.enfileirar({ configuracaoId: config.id, modo: "AUDITAR_E_APLICAR", completa: true, idempotencia: chave, origem: "MANUAL", solicitadoPor: usuario });
  async function reservarDetalhes() {
    const execucao = await enfileirar();
    // A fixture começa depois da listagem vazia já concluída. Checkpoints sem
    // plano agora reiniciam coleta, portanto não representam essa fronteira.
    for (const app of [a, b]) await db.olistSyncEtapa.updateMany({ where: { execucaoId: execucao.id, aplicativoId: app }, data: { fase: "DETALHAR", cursorJson: { plano: {
      modo: "COMPLETA", iniciadaEm: new Date().toISOString(), desde: null, desdeUtc: null, watermarkAnterior: null,
      geracao: 0, assinaturaEscopo: assinaturaEscopoSync("PRODUTO", [a, b]), contaIdentidade: `identidade-${app}`, fuso: null, versaoContrato: VERSAO_CONTRATO_INCREMENTAL,
    } } } });
    const primeira = await repo.reservarEtapa(), segunda = await repo.reservarEtapa();
    assert.ok(primeira); assert.ok(segunda); assert.notEqual(primeira.id, segunda.id);
    return { execucao, primeira, segunda };
  }

  await t.test("conclusão sequencial cria uma única comparação após a última conta", async () => {
    const { execucao, primeira, segunda } = await reservarDetalhes();
    await servico.processar(primeira);
    assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: execucao.id, fase: "COMPARAR" } }), 0);
    await servico.processar(segunda);
    assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: execucao.id, fase: "COMPARAR", status: "PENDENTE" } }), 1);
    assert.notEqual((await db.olistSyncExecucao.findUniqueOrThrow({ where: { id: execucao.id } })).status, "CONCLUIDA");
    assert.equal((await repo.reservarEtapa())?.fase, "COMPARAR");
  });

  await t.test("últimas contas concorrentes não perdem COMPARAR nem anunciam conclusão prematura", { timeout: 10_000 }, async () => {
    const { execucao, primeira, segunda } = await reservarDetalhes();
    let chegadas = 0;
    let liberar!: () => void;
    const barreira = new Promise<void>(resolve => { liberar = resolve; });
    // O timeout também permite uma implementação corrigida que serialize as duas
    // transações: a primeira precisa poder seguir enquanto a segunda aguarda o lock.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sincronizado = db.$extends({ query: { olistSyncEtapa: { async count({ args, query }) {
      const resultado = await query(args);
      if (args.where?.fase && typeof args.where.fase === "object" && Array.isArray(args.where.fase.in) && args.where.fase.in.includes("DETALHAR")) {
        chegadas++;
        if (chegadas === 1) timer = setTimeout(() => liberar(), 1_500);
        if (chegadas === 2) liberar();
        await barreira;
      }
      return resultado;
    } } } });
    // A extensão só controla o interleaving de consultas SQL reais. O tipo do
    // cliente estendido omite métodos administrativos que o serviço não utiliza.
    const concorrente = criarServicoOlistSync(sincronizado as unknown as PrismaClient, cliente);
    try {
      await Promise.all([concorrente.processar(primeira), concorrente.processar(segunda)]);
    } finally {
      if (timer) clearTimeout(timer);
      liberar();
    }
    const etapas = await db.olistSyncEtapa.findMany({ where: { execucaoId: execucao.id }, select: { fase: true, status: true } });
    assert.equal(etapas.filter(e => e.fase === "DETALHAR" && e.status === "CONCLUIDA").length, 2);
    assert.equal(etapas.filter(e => e.fase === "COMPARAR" && e.status === "PENDENTE").length, 1, "As duas transações não podem deixar a execução sem a próxima fase");
    assert.notEqual((await db.olistSyncExecucao.findUniqueOrThrow({ where: { id: execucao.id } })).status, "CONCLUIDA");
    assert.equal((await repo.reservarEtapa())?.fase, "COMPARAR");
  });

  await t.test("cancelamento concorrente com checkpoint não reabre uma etapa cancelada", { timeout: 10_000 }, async () => {
    const e = await enfileirar(), r = await repo.reservarEtapa(); assert.ok(r);
    let leuReserva!: () => void, liberar!: () => void;
    const reservaLida = new Promise<void>(resolve => { leuReserva = resolve; });
    const continuar = new Promise<void>(resolve => { liberar = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limiteDaBarreira = setTimeout(() => { leuReserva(); liberar(); }, 3_000);
    const sincronizado = db.$extends({ query: { olistSyncEtapa: { async findUniqueOrThrow({ args, query }) {
      const resultado = await query(args);
      if (args.where.id === r.id) {
        leuReserva();
        // Uma correção pode travar a execução junto da etapa. Nesse caso o
        // cancelamento aguarda; liberar a barreira impede deadlock no próprio teste.
        timer = setTimeout(() => liberar(), 1_500);
        await continuar;
      }
      return resultado;
    } } } });
    const concorrente = criarOlistSyncRepository(sincronizado as unknown as PrismaClient);
    try {
      await Promise.all([
        concorrente.salvarCheckpoint({ etapaId: r.id, leaseToken: r.leaseToken, cursor: { respostaPersistida: true } }),
        (async () => {
          await reservaLida;
          try { await repo.cancelarExecucao(e.id, pai); }
          finally { liberar(); }
        })(),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      clearTimeout(limiteDaBarreira);
      leuReserva(); liberar();
    }
    const concluida = await repo.concluirExecucaoQuandoPossivel(e.id);
    assert.equal(concluida?.status, "CANCELADA");
    const estado = await db.olistSyncEtapa.findUniqueOrThrow({ where: { id: r.id } });
    assert.deepEqual(estado.cursorJson, { respostaPersistida: true });
    assert.equal(estado.status, "CANCELADA");
    assert.equal(estado.leaseToken, null);
    assert.equal(await repo.reservarEtapa(), null);
  });

  await t.test("doze aceites simultâneos com a mesma chave persistem uma execução", async () => {
    const chave = randomUUID();
    const execucoes = await Promise.all(Array.from({ length: 12 }, () => enfileirar(chave)));
    assert.equal(new Set(execucoes.map(e => e.id)).size, 1);
    assert.equal(await db.olistSyncExecucao.count({ where: { configuracaoId: config.id } }), 1);
    assert.equal(await db.olistSyncEtapa.count({ where: { execucaoId: execucoes[0].id } }), 2);
    await assert.rejects(enfileirar(), /ativa/);
  });
});
