import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { criarRepositorioAnotarSku, type ReservaSku } from "../src/repositories/anotar-sku-repository";
import { hojeSku, dataIsoSku } from "../src/lib/anotar-sku/periodo";
import { processarEtapaSku } from "../src/services/processarAnotarSkuService";

const url = process.env.ANOTAR_SKU_TEST_DATABASE_URL;
test("Anotar SKU: PostgreSQL real, checkpoints, concorrência e API", { skip: !url }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));
  assert.match(endereco.pathname, /^\/anotar_sku_test/);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 8, options: "-c timezone=UTC" }), log: [{ emit: "event", level: "query" }] });
  const consultas: string[] = [];
  db.$on("query", evento => consultas.push(evento.query));
  t.after(() => db.$disconnect());
  const [existentes] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM pg_tables WHERE schemaname = 'public'`;
  assert.equal(existentes.total, 0, "O banco de teste precisa estar vazio.");
  await db.$executeRawUnsafe(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, jobs text NOT NULL DEFAULT 'ANOTAR_SKU');`);
  await db.$executeRawUnsafe(`CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY, pausado bool NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), termos_ignorados_nome_arquivo text[] DEFAULT '{}', variantes_permitidas text[] DEFAULT '{}');`);
  await db.$executeRawUnsafe(`INSERT INTO configuracoes_jobs(chave,pausado) VALUES ('processar-anotar-sku',false);`);
  await db.$executeRawUnsafe(`CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), nome text, email text, ativo bool DEFAULT true,
    pode_escrever_anotar_sku bool DEFAULT true, pode_visualizar_anotar_sku bool DEFAULT true, vendedor_olist_id text, pode_editar_configuracao bool DEFAULT false,
    pode_visualizar_olist_formas_pagamento bool DEFAULT false, pode_visualizar_olist_formas_recebimento bool DEFAULT false);`);
  await db.$executeRawUnsafe(`CREATE TABLE buscas_sku(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), situacoes text[] NOT NULL,
    quantidade_pedidos int DEFAULT 0, quantidade_skus int DEFAULT 0, created_at timestamptz DEFAULT now());`);
  await db.$executeRawUnsafe(`CREATE TABLE itens_busca_sku(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), busca_id uuid REFERENCES buscas_sku(id) ON DELETE CASCADE,
    aplicativo_id uuid NOT NULL REFERENCES aplicativo(id), pedido_olist_id text NOT NULL, sku text NOT NULL, quantidade int NOT NULL, titulo_produto text, created_at timestamptz DEFAULT now(), UNIQUE(aplicativo_id, pedido_olist_id, sku));`);
  await db.$executeRawUnsafe(`CREATE TABLE tipo_produto(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text UNIQUE, titulo text);`);
  await db.$executeRawUnsafe(`CREATE TABLE produto_olist(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku_final text UNIQUE, titulo_final text);`);
  for (const role of ["anon", "authenticated"]) {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$;`);
  }
  // pg permite múltiplas instruções no protocolo simples, usado só para esta migration local.
  const { Client } = await import("pg");
  const sql = new Client({ connectionString: url! }); await sql.connect(); t.after(() => sql.end());
  await sql.query(await readFile(new URL("../prisma/migrations/20261116214414_anotar_sku_async/migration.sql", import.meta.url), "utf8"));
  await sql.query(await readFile(new URL("../prisma/migrations/20261118001325_anotar_sku_periodo_alertas/migration.sql", import.meta.url), "utf8"));
  const app = crypto.randomUUID(), outroApp = crypto.randomUUID(), user = crypto.randomUUID(), outroUser = crypto.randomUUID();
  await db.$executeRaw`INSERT INTO aplicativo(id,nome) VALUES (${app}::uuid,'Teste'), (${outroApp}::uuid,'Outro')`;
  await db.$executeRaw`INSERT INTO usuario(id,aplicativo_id,nome,email) VALUES (${user}::uuid,${app}::uuid,'Teste','sku@example.test'), (${outroUser}::uuid,${outroApp}::uuid,'Outro','outro@example.test')`;
  await db.$executeRaw`INSERT INTO tipo_produto(sku,titulo) VALUES ('A','Produto A'), ('B','Produto B')`;
  const repo = criarRepositorioAnotarSku(db), escopo = { id: user, aplicativoId: app, podeVisualizar: true };
  const pagina = (r: ReservaSku, ids: string[]) => repo.pagina(r, ids.map(id => ({ id, dataCriacao: hojeSku() })));
  let buscaComTitulosId = "";
  const nova = () => repo.criar(escopo, { chave: crypto.randomUUID(), situacoes: ["0"] });
  async function reserva(): Promise<ReservaSku> {
    await db.$executeRaw`UPDATE busca_sku_jobs SET proxima_tentativa_em=now()-interval '1 second' WHERE status IN ('PENDENTE','AGUARDANDO_RETRY')`;
    const r = await repo.reservar(); assert.ok(r); return r;
  }
  async function detalhamento(ids: string[]) {
    await pagina(await reserva(), ids); await pagina(await reserva(), ids);
  }
  await t.test("RLS, permissões diretas e isolamento por FK composta", async () => {
    for (const tabela of ["busca_sku_jobs", "busca_sku_job_pedidos"]) {
      const rls = await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname=$1", [tabela]); assert.equal(rls.rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) {
        const grants = await sql.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS permitido", [role, tabela]); assert.equal(grants.rows[0].permitido, false);
      }
    }
    const j = await nova();
    await assert.rejects(db.buscaSkuJobPedido.create({ data: { jobId: j.id, aplicativoId: outroApp, pedidoOlistId: "1" } }));
    assert.equal((await repo.listar({ ...escopo, aplicativoId: outroApp })).jobs.length, 0);
    await assert.rejects(repo.agir({ ...escopo, aplicativoId: outroApp }, j.id, "cancelar"), /não encontrada/);
    await repo.agir(escopo, j.id, "cancelar");
  });
  await t.test("envios concorrentes idempotentes e apenas uma busca aberta", async () => {
    const entrada = { chave: crypto.randomUUID(), situacoes: ["0"] };
    const resultados = await Promise.all([repo.criar(escopo, entrada), repo.criar(escopo, entrada)]);
    assert.equal(resultados[0].id, resultados[1].id);
    await assert.rejects(repo.criar(escopo, { ...entrada, situacoes: ["3"] }), /outras situações/);
    await assert.rejects(nova(), /em aberto/);
    const reservas = await Promise.all([repo.reservar(), repo.reservar()]);
    assert.equal(reservas.filter(Boolean).length, 1);
    await repo.agir(escopo, resultados[0].id, "cancelar");
  });
  await t.test("configuração ausente/pausada bloqueia criação e reserva; reativação preserva progresso", async () => {
    const j = await nova(); await detalhamento(["700"]);
    await db.$executeRaw`DELETE FROM configuracoes_jobs WHERE chave='processar-anotar-sku'`;
    assert.equal(await repo.estaPausado(), true);
    assert.equal((await repo.disponibilidade(app)).habilitado, false);
    assert.equal(await repo.reservar(), null);
    const repetida = await repo.criar(escopo, { chave: j.chave, situacoes: j.situacoes }); assert.equal(repetida.id, j.id);
    await repo.agir(escopo, j.id, "cancelar");
    await assert.rejects(nova(), /pausadas/);
    await db.$executeRaw`INSERT INTO configuracoes_jobs(chave,pausado) VALUES ('processar-anotar-sku',true)`;
    await assert.rejects(nova(), /pausadas/);
    await db.$executeRaw`UPDATE configuracoes_jobs SET pausado=false WHERE chave='processar-anotar-sku'`;
    const novo = await nova(); await detalhamento(["701"]);
    const r = await reserva(); await repo.falhar(r, "Falha de teste", "TESTE", null);
    await db.$executeRaw`UPDATE configuracoes_jobs SET pausado=true WHERE chave='processar-anotar-sku'`;
    await assert.rejects(repo.agir(escopo, novo.id, "retomar"), /pausadas/);
    await db.$executeRaw`UPDATE configuracoes_jobs SET pausado=false WHERE chave='processar-anotar-sku'`;
    await repo.agir(escopo, novo.id, "retomar");
    const retomado = await reserva(); assert.equal(retomado.encontrados, 1); assert.equal(retomado.etapa, "DETALHAMENTO");
    await repo.agir(escopo, novo.id, "cancelar");
  });
  await t.test("permissão por aplicativo filtra novas reservas e recuperação sem afetar outros apps", async () => {
    const j = await nova(); const r = await reserva();
    await db.$executeRaw`UPDATE aplicativo SET jobs='OUTRO_ANOTAR_SKU, ANOTAR_SKU_EXTRA' WHERE id=${app}::uuid`;
    await db.$executeRaw`UPDATE busca_sku_jobs SET reserva_ate=now()-interval '1 second' WHERE id=${j.id}::uuid`;
    assert.equal((await repo.disponibilidade(app)).habilitado, false);
    assert.equal(await repo.reservar(), null);
    assert.equal((await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } })).tentativas, r.tentativas);
    const outroEscopo = { id: outroUser, aplicativoId: outroApp, podeVisualizar: true };
    const outro = await repo.criar(outroEscopo, { chave: crypto.randomUUID(), situacoes: ["0"] });
    assert.equal((await reserva()).id, outro.id);
    await repo.agir(outroEscopo, outro.id, "cancelar");
    await db.$executeRaw`UPDATE aplicativo SET jobs=' NOTIFICAR , anotar_sku , RENOVAR_TOKENS ' WHERE id=${app}::uuid`;
    assert.equal((await repo.disponibilidade(app)).habilitado, true);
    assert.equal((await reserva()).id, j.id);
    await repo.agir(escopo, j.id, "cancelar");
    await db.$executeRaw`UPDATE aplicativo SET jobs='' WHERE id=${app}::uuid`;
    await assert.rejects(nova(), /não está habilitado para este aplicativo/);
    await db.$executeRaw`UPDATE aplicativo SET jobs='ANOTAR_SKU' WHERE id=${app}::uuid`;
  });
  await t.test("retomada após expiração impede gravação do worker anterior", async () => {
    const j = await nova(); await detalhamento(["10"]);
    const antigo = await reserva();
    await db.$executeRaw`UPDATE busca_sku_jobs SET reserva_ate=now()-interval '1 second' WHERE id=${j.id}::uuid`;
    const novo = await reserva(); assert.notEqual(novo.reservaId, antigo.reservaId);
    assert.equal(await repo.pedido(antigo, "10", [{ sku: "A", quantidade: 999 }], false), null);
    assert.equal(await repo.pedido(novo, "10", [{ sku: "A", quantidade: 2 }], false), true);
    const estado = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } }); assert.equal(estado.processados, 1); assert.equal(estado.tentativas, 0);
    await repo.agir(escopo, j.id, "cancelar");
  });
  await t.test("paginação retoma o offset e reconcilia duas situações sem duplicar IDs", async () => {
    const j = await repo.criar(escopo, { chave: crypto.randomUUID(), situacoes: ["0", "3"] });
    const pagina = Array.from({ length: 100 }, (_, i) => String(1000 + i));
    await pagina(await reserva(), pagina);
    const segunda = await reserva(); assert.equal(segunda.paginaOffset, 100); assert.equal(segunda.situacaoIndice, 0);
    await pagina(segunda, ["1100"]);
    const situacao = await reserva(); assert.equal(situacao.situacaoIndice, 1); assert.equal(situacao.paginaOffset, 0);
    await pagina(situacao, ["1000", "1101"]);
    const reconciliacao = await reserva(); assert.equal(reconciliacao.passagem, 1); assert.equal(reconciliacao.situacaoIndice, 0);
    await pagina(reconciliacao, ["1102"]); await pagina(await reserva(), ["1000"]);
    const final = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.equal(final.encontrados, 103); assert.equal(final.etapa, "DETALHAMENTO");
    await repo.agir(escopo, j.id, "cancelar");
  });
  await t.test("falha durante publicação reverte histórico inteiro e permite nova tentativa", async () => {
    const j = await nova(); await detalhamento(["800"]);
    await repo.pedido(await reserva(), "800", [{ sku: "A", quantidade: 3 }], false);
    await repo.prepararConclusao(await reserva());
    const r = await reserva(), quantidadeAntes = await db.buscaSku.count();
    await sql.query(`CREATE FUNCTION rejeitar_item_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha controlada'; END $$;
      CREATE TRIGGER falha_item_teste BEFORE INSERT ON itens_busca_sku FOR EACH ROW EXECUTE FUNCTION rejeitar_item_teste();`);
    try {
      await assert.rejects(repo.concluir(r));
      assert.equal(await db.buscaSku.count(), quantidadeAntes);
      assert.equal(await db.itemBuscaSku.count({ where: { pedidoOlistId: "800" } }), 0);
      assert.equal((await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } })).status, "PROCESSANDO");
    } finally { await sql.query("DROP TRIGGER falha_item_teste ON itens_busca_sku; DROP FUNCTION rejeitar_item_teste();"); }
    await repo.falhar(r, "Falha temporária", "TESTE", 60_000);
    assert.equal(await repo.concluir(await reserva()), true);
    assert.equal(await db.itemBuscaSku.count({ where: { pedidoOlistId: "800" } }), 1);
  });
  await t.test("checkpoint, deduplicação por pedido, consolidação e exclusão", async () => {
    const anterior = await db.buscaSku.create({ data: { aplicativoId: app, situacoes: ["0"] } });
    await db.itemBuscaSku.create({ data: { buscaId: anterior.id, aplicativoId: app, pedidoOlistId: "1", sku: "A", quantidade: 8 } });
    const j = await nova(); await detalhamento(["1", "2", "2"]);
    const cliente = { listar: async () => [], detalhar: async (a: string, id: string) => { assert.equal(a, app); assert.equal(id, "2"); return [{ sku: "A", quantidade: 4 }, { sku: "B", quantidade: 2 }]; } };
    await assert.rejects(repo.excluir(escopo, anterior.id), /busca em aberto/);
    for (let i = 0; i < 3; i++) assert.equal(await processarEtapaSku(await reserva(), repo, cliente), "progresso");
    const final = await reserva(); assert.equal(final.etapa, "CONSOLIDACAO");
    await repo.concluir(final); assert.equal(await repo.concluir(final), null);
    const concluido = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } }); assert.equal(concluido.status, "CONCLUIDO"); assert.equal(concluido.ignorados, 1);
    assert.ok(concluido.buscaId);
    const resultado = await db.buscaSku.findUniqueOrThrow({ where: { id: concluido.buscaId }, include: { itens: true } });
    assert.equal(resultado.quantidadePedidos, 1); assert.equal(resultado.quantidadeSkus, 2); assert.equal(resultado.itens.length, 2);
    assert.deepEqual(resultado.itens.map(i => i.quantidade).sort(), [2, 4]);
    await repo.excluir(escopo, resultado.id);
    const repetido = await repo.criar(escopo, { chave: j.chave, situacoes: j.situacoes });
    assert.equal(repetido.status, "CONCLUIDO"); assert.equal(repetido.buscaId, null); assert.equal(repetido.teveResultado, true);
    await repo.excluir(escopo, anterior.id);
  });
  await t.test("cancelamento concorrente com conclusão publica tudo ou nada", async () => {
    const j = await nova(); await detalhamento(["20"]); await repo.pedido(await reserva(), "20", [{ sku: "A", quantidade: 3 }], false); await repo.prepararConclusao(await reserva());
    const r = await reserva(); await Promise.allSettled([repo.concluir(r), repo.agir(escopo, j.id, "cancelar")]);
    const final = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } });
    assert.ok(["CONCLUIDO", "CANCELADO"].includes(final.status));
    assert.equal(await db.itemBuscaSku.count({ where: { pedidoOlistId: "20" } }), final.status === "CONCLUIDO" ? 1 : 0);
  });
  await t.test("interrupções esgotam tentativas e retry manual preserva checkpoint", async () => {
    const j = await nova(); await detalhamento(["30"]);
    for (let i = 0; i < 5; i++) { await reserva(); await db.$executeRaw`UPDATE busca_sku_jobs SET reserva_ate=now()-interval '1 second' WHERE id=${j.id}::uuid`; }
    assert.equal(await repo.reservar(), null);
    assert.equal((await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } })).status, "FALHOU");
    await assert.rejects(nova(), /em aberto/);
    await repo.agir(escopo, j.id, "retomar"); assert.equal((await reserva()).tentativas, 1);
    await repo.agir(escopo, j.id, "cancelar");
  });
  await t.test("busca vazia conclui sem histórico falso", async () => {
    const j = await nova(); await detalhamento([]); await repo.prepararConclusao(await reserva()); await repo.concluir(await reserva());
    const final = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } }); assert.equal(final.status, "CONCLUIDO"); assert.equal(final.buscaId, null);
  });
  await t.test("consolidação salva título final, título do tipo ou descrição da Olist", async () => {
    await db.$executeRaw`INSERT INTO produto_olist(sku_final,titulo_final) VALUES ('A','Titulo final A'), ('B',' ')`;
    const j = await nova(); await detalhamento(["950"]);
    await repo.pedido(await reserva(), "950", [
      { sku: "A", quantidade: 2, tituloProduto: "Olist A" },
      { sku: "B", quantidade: 3, tituloProduto: "Olist B" },
      { sku: "C", quantidade: 4, tituloProduto: "Descricao Olist C" },
      { sku: "D", quantidade: 5 },
      { sku: "F", quantidade: 1, tituloProduto: "=1+1" },
    ], false);
    await repo.prepararConclusao(await reserva()); await repo.concluir(await reserva());
    const final = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: j.id } }); assert.ok(final.buscaId); buscaComTitulosId = final.buscaId;
    const itens = await db.itemBuscaSku.findMany({ where: { buscaId: buscaComTitulosId } });
    assert.deepEqual(Object.fromEntries(itens.map(i => [i.sku, i.tituloProduto])), { A: "Titulo final A", B: "Produto B", C: "Descricao Olist C", D: null, F: "=1+1" });
    // A remoção posterior no catálogo não pode apagar o título salvo no resultado.
    await db.$executeRaw`DELETE FROM produto_olist WHERE sku_final='A'`;
    await db.$executeRaw`DELETE FROM tipo_produto WHERE sku='A'`;
  });
  await t.test("API exige sessão/permissão, não expõe reserva e exporta só resultados", async () => {
    Object.assign(globalThis, { prisma: db });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
    // A antiga variável não deve mais controlar a disponibilidade.
    process.env.ANOTAR_SKU_ASYNC_ENABLED = "false";
    const { supabaseAdmin } = await import("../src/lib/supabase-admin");
    t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: user, email: "sku@example.test" } }, error: null }));
    const api = await import("../src/app/api/olist/anotar-sku/jobs/route");
    const { NextRequest } = await import("next/server");
    const historico = await import("../src/app/api/olist/anotar-sku/route");
    const req = (method = "GET", body?: unknown, token = true) => new Request("https://example.test/api", { method, headers: token ? { Authorization: "Bearer teste" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await api.GET(req("GET", undefined, false))).status, 401);
    assert.equal((await (await api.GET(req())).json()).habilitado, true);
    assert.equal((await api.POST(req("POST", { chave: "x", situacoes: ["0"] }))).status, 400);
    const resposta = await api.POST(req("POST", { chave: crypto.randomUUID(), situacoes: ["0"] })); assert.equal(resposta.status, 202);
    const json = await resposta.json(); assert.equal(json.job.status, "PENDENTE"); assert.equal("reservaId" in json.job, false); assert.equal("solicitadoPor" in json.job, false);
    assert.equal((await historico.POST(new NextRequest(req("POST")))).status, 409);
    await db.$executeRaw`UPDATE usuario SET pode_visualizar_anotar_sku=false WHERE id=${user}::uuid`;
    assert.equal((await api.GET(req())).status, 200);
    assert.equal((await historico.GET(new NextRequest(req()))).status, 403);
    await db.$executeRaw`UPDATE usuario SET pode_escrever_anotar_sku=false WHERE id=${user}::uuid`;
    assert.equal((await api.GET(req())).status, 403);
    await db.$executeRaw`UPDATE usuario SET pode_escrever_anotar_sku=true, pode_visualizar_anotar_sku=true WHERE id=${user}::uuid`;
    await repo.agir(escopo, json.job.id, "cancelar");
    const busca = await db.buscaSku.create({ data: { aplicativoId: app, situacoes: ["0"] } });
    await db.itemBuscaSku.create({ data: { buscaId: busca.id, aplicativoId: app, pedidoOlistId: "90", sku: "A", quantidade: 2 } });
    for (const formato of ["csv", "xlsx", "pdf"]) {
      const arquivo = await historico.GET(new NextRequest(`https://example.test/api?id=${busca.id}&formato=${formato}`, { headers: { Authorization: "Bearer teste" } }));
      assert.equal(arquivo.status, 200); assert.ok((await arquivo.arrayBuffer()).byteLength > 0);
    }
    const comTitulos = await historico.GET(new NextRequest(`https://example.test/api?id=${buscaComTitulosId}`, { headers: { Authorization: "Bearer teste" } }));
    assert.equal(comTitulos.status, 200);
    const detalhe = await comTitulos.json();
    assert.deepEqual(Object.fromEntries(detalhe.busca.skus.map((i: { sku: string; tituloProduto: string | null }) => [i.sku, i.tituloProduto])), { A: "Titulo final A", B: "Produto B", C: "Descricao Olist C", D: null, F: "=1+1" });
    for (const formato of ["csv", "xlsx", "pdf"]) {
      const arquivo = await historico.GET(new NextRequest(`https://example.test/api?id=${buscaComTitulosId}&formato=${formato}`, { headers: { Authorization: "Bearer teste" } }));
      assert.equal(arquivo.status, 200);
      const conteudo = Buffer.from(await arquivo.arrayBuffer()).toString(formato === "pdf" ? "latin1" : "utf8");
      for (const titulo of ["Titulo final A", "Produto B", "Descricao Olist C"]) assert.ok(conteudo.includes(titulo), `${formato} deve conter ${titulo}`);
      if (formato === "csv") assert.ok(conteudo.includes('"F","\'=1+1","1"'), "CSV deve neutralizar fórmulas em títulos");
    }
    const cron = await import("../src/app/api/cron/processar-anotar-sku/route");
    delete process.env.CRON_SECRET; assert.equal((await cron.GET(req())).status, 401);
    process.env.CRON_SECRET = "teste";
    await db.$executeRaw`UPDATE configuracoes_jobs SET pausado=true WHERE chave='processar-anotar-sku'`;
    assert.deepEqual(await (await cron.GET(req())).json(), { pausado: true });
    assert.equal((await (await api.GET(req())).json()).habilitado, false);
    await db.$executeRaw`UPDATE configuracoes_jobs SET pausado=false WHERE chave='processar-anotar-sku'`;
    await db.$executeRaw`UPDATE aplicativo SET jobs='' WHERE id=${app}::uuid`;
    const estado = await (await api.GET(req())).json(); assert.equal(estado.habilitado, false); assert.match(estado.motivoPausa, /este aplicativo/);
    assert.equal((await api.POST(req("POST", { chave: crypto.randomUUID(), situacoes: ["0"] }))).status, 403);
    assert.deepEqual(await (await cron.GET(req())).json(), { ok: true, progresso: 0, retry: 0, falha: 0, reserva_perdida: 0 });
  });
  await t.test("pedidos por SKU: paginação limitada, quantidades, projeção e isolamento", async () => {
    const { GET } = await import("../src/app/api/olist/anotar-sku/[id]/pedidos/route");
    const { NextRequest } = await import("next/server");
    const sku = "AUDITORIA / azul & verde + 90x90";
    const busca = await db.buscaSku.create({ data: { aplicativoId: app, situacoes: ["0"] } });
    const outraBusca = await db.buscaSku.create({ data: { aplicativoId: app, situacoes: ["0"] } });
    const buscaOutroApp = await db.buscaSku.create({ data: { aplicativoId: outroApp, situacoes: ["0"] } });
    const pedidos = Array.from({ length: 53 }, (_, i) => ({ id: String(710000 + i), quantidade: i % 3 + 1 }));
    await db.itemBuscaSku.createMany({ data: [
      ...pedidos.map(p => ({ buscaId: busca.id, aplicativoId: app, pedidoOlistId: p.id, sku, quantidade: p.quantidade })),
      { buscaId: busca.id, aplicativoId: app, pedidoOlistId: "999991", sku: "OUTRO SKU", quantidade: 99 },
      { buscaId: outraBusca.id, aplicativoId: app, pedidoOlistId: "999992", sku, quantidade: 99 },
      { buscaId: buscaOutroApp.id, aplicativoId: outroApp, pedidoOlistId: "710000", sku, quantidade: 99 },
    ] });
    consultas.length = 0;
    const primeira = await repo.pedidosPorSku(escopo, busca.id, sku);
    assert.deepEqual(primeira.pedidos, pedidos.slice(0, 50));
    assert.equal(primeira.proximoCursor, pedidos[49].id);
    assert.equal(consultas.length, 2, "Uma verificação da busca e uma página de itens, sem N+1");
    assert.match(consultas[1], /LIMIT/);
    assert.doesNotMatch(consultas[1], /titulo_produto|created_at/, "Não transfere títulos ou metadados para listar IDs");
    assert.ok(Buffer.byteLength(JSON.stringify(primeira)) < 3_000, "Página de 50 IDs deve ser pequena");
    const consultar = (id = busca.id, parametros: Record<string, string> = { sku }, autenticado = true) => GET(
      new NextRequest(`https://example.test/api?${new URLSearchParams(parametros)}`, { headers: autenticado ? { Authorization: "Bearer teste" } : {} }),
      { params: Promise.resolve({ id }) },
    );
    const resposta = await consultar();
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await resposta.json(), primeira);
    const segunda = await (await consultar(busca.id, { sku, cursor: primeira.proximoCursor! })).json();
    assert.deepEqual(segunda, { pedidos: pedidos.slice(50), proximoCursor: null });
    assert.deepEqual(await (await consultar(busca.id, { sku, cursor: pedidos.at(-1)!.id })).json(), { pedidos: [], proximoCursor: null });
    assert.deepEqual(await (await consultar(busca.id, { sku: "inexistente" })).json(), { pedidos: [], proximoCursor: null });
    assert.equal((await consultar(buscaOutroApp.id)).status, 404);
    assert.equal((await consultar(crypto.randomUUID())).status, 404);
    assert.equal((await consultar("invalido")).status, 400);
    const parametrosInvalidos: Record<string, string>[] = [{}, { sku: "" }, { sku: "x".repeat(513) }, { sku, cursor: "" }, { sku, cursor: "x".repeat(129) }];
    for (const parametros of parametrosInvalidos) {
      assert.equal((await consultar(busca.id, parametros)).status, 400);
    }
    assert.equal((await consultar(busca.id, { sku }, false)).status, 401);
    await assert.rejects(repo.pedidosPorSku({ ...escopo, podeVisualizar: false }, busca.id, sku), /permissão/);
    try {
      await db.$executeRaw`UPDATE usuario SET pode_visualizar_anotar_sku=false WHERE id=${user}::uuid`;
      assert.equal((await consultar()).status, 403, "Permissão de escrita não concede leitura");
      await db.$executeRaw`UPDATE usuario SET pode_visualizar_anotar_sku=true, ativo=false WHERE id=${user}::uuid`;
      assert.equal((await consultar()).status, 401, "Usuário inativo não possui sessão válida");
    } finally { await db.$executeRaw`UPDATE usuario SET pode_visualizar_anotar_sku=true, ativo=true WHERE id=${user}::uuid`; }
  });
});
