import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { criarRepositorioPedidosSemEnvio } from "../src/repositories/pedidos-sem-envio-repository";
import { processarPaginaSemEnvio } from "../src/services/pedidosSemEnvioService";
import { FalhaPedidosSemEnvio } from "../src/lib/pedidos-sem-envio";

const url = process.env.PEDIDOS_SEM_ENVIO_TEST_DATABASE_URL;
test("pedidos sem envio: PostgreSQL real, atomicidade, retomada e isolamento", { skip: !url }, async t => {
  const destino = new URL(url!);
  assert.ok(["127.0.0.1", "localhost"].includes(destino.hostname));
  assert.match(destino.pathname, /^\/pedidos_sem_envio_test/);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8 }) });
  t.after(() => db.$disconnect());
  const { Client } = await import("pg");
  const sql = new Client({ connectionString: url! }); await sql.connect(); t.after(() => sql.end());
  const existentes = await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'");
  assert.equal(existentes.rows[0].total, 0, "Exige um banco de teste vazio e exclusivo.");
  await sql.query(`
    CREATE TABLE aplicativo(id uuid PRIMARY KEY, nome text NOT NULL, jobs text NOT NULL DEFAULT '', whatsapp text NOT NULL DEFAULT '5511999999999');
    CREATE TABLE integracao_olist_tokens(aplicativo_id uuid, provider text DEFAULT 'olist', status text DEFAULT 'conectado');
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY, pausado boolean DEFAULT true);
    CREATE TYPE "NotificationType" AS ENUM ('WHATSAPP');
    CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE','SUCESSO','ERRO');
    CREATE TABLE notification(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo "NotificationType", "to" varchar(30), titulo text, mensagem text,
      data timestamptz DEFAULT now(), status "NotificationStatus" DEFAULT 'PENDENTE', tentativas int DEFAULT 0, ultimo_erro text,
      processando_em timestamptz, worker_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  `);
  await sql.query(await readFile(new URL("../prisma/migrations/20261119002413_pedidos_sem_envio/migration.sql", import.meta.url), "utf8"));
  const app = randomUUID(), outro = randomUUID(), semNotificar = randomUUID(), parcial = randomUUID();
  await sql.query(`INSERT INTO aplicativo(id,nome,jobs) VALUES ($1,'App A',' alertar_pedidos_sem_envio , NOTIFICAR '),
    ($2,'App B','ALERTAR_PEDIDOS_SEM_ENVIO,NOTIFICAR'), ($3,'Sem notificação','ALERTAR_PEDIDOS_SEM_ENVIO'),
    ($4,'Chave parcial','ALERTAR_PEDIDOS_SEM_ENVIO_EXTRA,NOTIFICAR')`, [app, outro, semNotificar, parcial]);
  await sql.query("INSERT INTO integracao_olist_tokens(aplicativo_id) VALUES ($1), ($2), ($3), ($4)", [app, outro, semNotificar, parcial]);
  const repo = criarRepositorioPedidosSemEnvio(db);
  const pedido = { id: "123", numero: "456", situacao: 1, dataCriacao: "2026-11-12" };
  const pagina = { pedidos: [pedido], total: 1 };
  const liberarTempo = () => sql.query("UPDATE pedido_sem_envio_jobs SET proxima_tentativa_em=now()-interval '1 second'");
  const reservar = async () => { await liberarTempo(); const r = await repo.reservar(); assert.ok(r); return r; };

  await t.test("pausado por padrão e autorização exata no agendamento", async () => {
    assert.equal(await repo.estaPausado(), true);
    assert.equal(await repo.agendar("2026-11-18"), 0);
    await sql.query("UPDATE configuracoes_jobs SET pausado=false");
    assert.equal(await repo.agendar("2026-11-18"), 2);
    assert.equal(await repo.agendar("2026-11-18"), 0);
    assert.equal(await db.pedidoSemEnvioJob.count(), 2);
    await sql.query("UPDATE integracao_olist_tokens SET status='desconectado' WHERE aplicativo_id=$1", [outro]);
  });
  await t.test("tabelas privadas com RLS e sem privilégios de cliente", async () => {
    for (const tabela of ["pedido_sem_envio_jobs", "pedido_sem_envio_alertas"]) {
      assert.equal((await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname=$1", [tabela])).rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) assert.equal((await sql.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS permitido", [role, tabela])).rows[0].permitido, false);
    }
  });
  await t.test("duas reservas simultâneas não processam o mesmo aplicativo", async () => {
    const reservas = (await Promise.all([repo.reservar(), repo.reservar()])).filter(r => r !== null);
    assert.equal(reservas.length, 1);
    assert.equal(reservas[0].aplicativoId, app);
    const [salvo, repetido] = await Promise.all([repo.salvarPagina(reservas[0], pagina), repo.salvarPagina(reservas[0], pagina)]);
    assert.equal([salvo, repetido].filter(Boolean).length, 1);
    assert.equal(await db.notification.count(), 1);
    assert.equal(await db.pedidoSemEnvioAlerta.count(), 1);
    const job = await db.pedidoSemEnvioJob.findUniqueOrThrow({ where: { aplicativoId: app } });
    assert.equal(job.situacaoIndice, 1);
    assert.equal(job.pedidosAlertados, 1);
  });
  await t.test("troca de situação não duplica alerta no mesmo dia; conclusão não reabre", async () => {
    const r = await reservar();
    assert.deepEqual(await repo.salvarPagina(r, { pedidos: [{ ...pedido, situacao: 7 }], total: 1 }), { pedidos: 0, notificacoes: 0, concluido: true });
    assert.equal(await repo.agendar("2026-11-18"), 0);
    assert.equal(await repo.reservar(), null);
    const n = await db.notification.findFirstOrThrow();
    assert.equal(n.status, "PENDENTE");
    assert.match(n.mensagem, /Pedido 456.*6 dias/);
    assert.equal(n.to, "5511999999999");
  });
  await t.test("dia seguinte permite novo lembrete e mantém rodada aberta", async () => {
    assert.equal(await repo.agendar("2026-11-19"), 1);
    assert.equal(await repo.agendar("2026-11-20"), 0);
    const salvo = await repo.salvarPagina(await reservar(), pagina);
    assert.equal(salvo?.pedidos, 1);
    assert.equal(await db.notification.count(), 2);
  });
  await t.test("destinatário inválido reverte deduplicação e avanço; múltiplos números são atômicos", async () => {
    const r = await reservar();
    await sql.query("UPDATE aplicativo SET whatsapp='5511999999999,invalido' WHERE id=$1", [app]);
    const nova = { pedidos: [{ ...pedido, id: "999", situacao: 7 }], total: 1 };
    await assert.rejects(repo.salvarPagina(r, nova));
    assert.equal(await db.pedidoSemEnvioAlerta.count({ where: { pedidoOlistId: "999" } }), 0);
    assert.equal(await db.notification.count(), 2);
    assert.equal((await db.pedidoSemEnvioJob.findUniqueOrThrow({ where: { aplicativoId: app } })).reservaId, r.reservaId);
    await sql.query("UPDATE aplicativo SET whatsapp='5511999999999,5537999999999,5511999999999' WHERE id=$1", [app]);
    assert.equal((await repo.salvarPagina(r, nova))?.notificacoes, 2);
    assert.equal(await db.notification.count(), 4);
  });
  await t.test("reserva vencida é retomada e o worker anterior não salva", async () => {
    await repo.agendar("2026-11-20");
    const antiga = await reservar();
    await sql.query("UPDATE pedido_sem_envio_jobs SET reserva_ate=now()-interval '1 second' WHERE aplicativo_id=$1", [app]);
    const nova = await reservar();
    assert.notEqual(nova.reservaId, antiga.reservaId);
    assert.equal(nova.tentativas, 2);
    assert.equal(await repo.salvarPagina(antiga, pagina), null);
    assert.equal(await repo.falhar(antiga, "ANTIGA", null), false);
    await repo.salvarPagina(nova, { pedidos: [], total: 0 });
  });
  await t.test("pausa e revogação após reserva impedem notificações", async () => {
    const r = await reservar();
    await sql.query("UPDATE configuracoes_jobs SET pausado=true");
    assert.equal(await repo.salvarPagina(r, pagina), null);
    await sql.query("UPDATE configuracoes_jobs SET pausado=false");
    await sql.query("UPDATE aplicativo SET jobs='NOTIFICAR' WHERE id=$1", [app]);
    assert.equal(await repo.salvarPagina(r, pagina), null);
    await sql.query("UPDATE aplicativo SET jobs='ALERTAR_PEDIDOS_SEM_ENVIO,NOTIFICAR' WHERE id=$1", [app]);
    await repo.salvarPagina(r, { pedidos: [], total: 0 });
  });
  await t.test("páginas menores respeitam total; o corte local exclui status e datas divergentes", async () => {
    await repo.agendar("2026-11-21");
    const r = await reservar();
    await repo.salvarPagina(r, { pedidos: [{ ...pedido, id: "700", situacao: 5 }, { ...pedido, id: "701", dataCriacao: "2026-11-16" }], total: 3 });
    const job = await db.pedidoSemEnvioJob.findUniqueOrThrow({ where: { aplicativoId: app } });
    assert.equal(job.paginaOffset, 2);
    assert.equal(job.situacaoIndice, 0);
    assert.equal(job.pedidosAlertados, 0);
  });
  await t.test("limite de retries e morte na quinta tentativa terminam em FALHOU", async () => {
    await sql.query("UPDATE pedido_sem_envio_jobs SET tentativas=4 WHERE aplicativo_id=$1", [app]);
    const r = await reservar();
    await processarPaginaSemEnvio(repo, { listar: async () => { throw new FalhaPedidosSemEnvio("OLIST_429", true); } }, r);
    assert.equal((await db.pedidoSemEnvioJob.findUniqueOrThrow({ where: { aplicativoId: app } })).status, "FALHOU");
    await repo.agendar("2026-11-22");
    await sql.query("UPDATE pedido_sem_envio_jobs SET tentativas=4 WHERE aplicativo_id=$1", [app]);
    await reservar();
    await sql.query("UPDATE pedido_sem_envio_jobs SET reserva_ate=now()-interval '1 second' WHERE aplicativo_id=$1", [app]);
    assert.equal(await repo.reservar(), null);
    const job = await db.pedidoSemEnvioJob.findUniqueOrThrow({ where: { aplicativoId: app } });
    assert.equal(job.status, "FALHOU"); assert.equal(job.erroCodigo, "RESERVA_EXPIRADA");
  });
  await t.test("mesmo ID Olist em outro aplicativo tem destinatário e deduplicação próprios", async () => {
    await sql.query("UPDATE integracao_olist_tokens SET status='desconectado' WHERE aplicativo_id=$1", [app]);
    await sql.query("UPDATE integracao_olist_tokens SET status='conectado' WHERE aplicativo_id=$1", [outro]);
    await sql.query("UPDATE aplicativo SET whatsapp='5531999999999' WHERE id=$1", [outro]);
    const r = await reservar();
    assert.equal(r.aplicativoId, outro);
    assert.equal((await repo.salvarPagina(r, pagina))?.pedidos, 1);
    assert.equal(await db.notification.count({ where: { to: "5531999999999" } }), 1);
    assert.equal(await db.pedidoSemEnvioAlerta.count({ where: { pedidoOlistId: "123" } }), 2);
  });
  await t.test("limpeza retém a rodada atual e remove no máximo 500 registros antigos", async () => {
    await sql.query("INSERT INTO pedido_sem_envio_alertas(aplicativo_id,pedido_olist_id,referencia) SELECT $1,(90000+n)::text,'2026-09-01'::date FROM generate_series(1,510) n", [app]);
    await sql.query("INSERT INTO pedido_sem_envio_alertas(aplicativo_id,pedido_olist_id,referencia) VALUES ($1,'888','2026-11-18')", [outro]);
    assert.equal(await repo.limparAntigos("2027-01-01"), 500);
    assert.equal(await db.pedidoSemEnvioAlerta.count({ where: { aplicativoId: app, referencia: new Date("2026-09-01") } }), 10);
    assert.equal(await db.pedidoSemEnvioAlerta.count({ where: { aplicativoId: outro, pedidoOlistId: "888" } }), 1);
  });
});
