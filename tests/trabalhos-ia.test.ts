import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";
import type { BancoIa, SqlIa } from "../src/lib/trabalhos-ia/banco";
import { criarServicoTrabalhosIa } from "../src/lib/trabalhos-ia/servico";
import { criarRegistroIa, type TipoTrabalhoIa } from "../src/lib/trabalhos-ia/registro";
import { relatorioSkuIa, validarRelatorioSkuIa } from "../src/lib/trabalhos-ia/relatorio-sku";
import { lerRelatorioIa } from "../src/lib/trabalhos-ia/relatorio-leitura";
import { respostaReservaIaSchema, TIPO_RELATORIO_SKU, type WorkerIa } from "../src/lib/trabalhos-ia/contrato";
import { autenticarWorkerIa } from "../src/lib/trabalhos-ia/credenciais";
import { executarTextoCodex } from "../src/lib/trabalhos-ia/executor-codex";
import { consumirEtapaIa } from "../src/lib/trabalhos-ia/worker";

async function fixture(t: { after: (fn: () => Promise<void>) => void }, tipos: TipoTrabalhoIa[] = [relatorioSkuIa]) {
  const pg = criarPostgresMemoria(); t.after(() => pg.close());
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE aplicativo(id uuid PRIMARY KEY);
    CREATE TABLE usuario(id uuid PRIMARY KEY,aplicativo_id uuid,ativo boolean DEFAULT true,pode_visualizar_anotar_sku boolean DEFAULT true,pode_escrever_anotar_sku boolean DEFAULT true,pode_editar_configuracao boolean DEFAULT true);
    CREATE TABLE buscas_sku(id uuid PRIMARY KEY,aplicativo_id uuid);
    CREATE TABLE itens_busca_sku(busca_id uuid,aplicativo_id uuid,sku text,titulo_produto text,quantidade integer,pedido_olist_id text);
    CREATE TABLE produto_olist(sku_final text PRIMARY KEY,titulo_final text);
    CREATE TABLE tipo_produto(sku text PRIMARY KEY,titulo text);`);
  await pg.exec(await readFile(new URL("../prisma/migrations/20261120210023_trabalhos_ia/migration.sql", import.meta.url), "utf8"));
  const app = randomUUID(), outroApp = randomUUID(), usuario = randomUUID(), busca = randomUUID();
  await pg.query("INSERT INTO aplicativo VALUES($1),($2)", [app, outroApp]);
  await pg.query("INSERT INTO usuario(id,aplicativo_id) VALUES($1,$2)", [usuario, app]);
  await pg.query("INSERT INTO buscas_sku VALUES($1,$2)", [busca, app]);
  await pg.query("INSERT INTO itens_busca_sku VALUES($1,$2,'01','Kit 2 Lenços Sedinha 70x70cm',2,'1'),($1,$2,'02','Bandeira Oxford 90x60cm Paraná',9,'1'),($1,$2,'01','Kit 2 Lenços Sedinha 70x70cm',3,'2'),($1,$2,'03','Tecido Tricoline Natal',1,'2'),($1,$2,'04','Toalha estampada',1,'2')", [busca, app]);
  const sql: SqlIa = {
    consultar: async <T>(q: Prisma.Sql) => (await pg.query<T>(q.text, q.values)).rows,
    executar: async q => { await pg.query(q.text, q.values); return 1; },
  };
  let fila: Promise<unknown> = Promise.resolve();
  const db: BancoIa = { ...sql, transacao: <T>(fn: (tx: SqlIa) => Promise<T>) => {
    const exec = fila.then(async () => { await pg.exec("BEGIN"); try { const r = await fn(sql); await pg.exec("COMMIT"); return r; } catch (e) { await pg.exec("ROLLBACK"); throw e; } });
    fila = exec.catch(() => {}); return exec;
  } };
  const servico = criarServicoTrabalhosIa(db, criarRegistroIa(tipos));
  const escopo = { id: usuario, aplicativoId: app };
  const worker: WorkerIa = { id: "worker", aplicativoId: app, tipos: tipos.map(t => t.tipo), grupo: "vm-1" };
  const reservar = async (w = worker) => respostaReservaIaSchema.parse(await servico.operar(w, { acao: "reservar", protocolo: 1, tipos: w.tipos }));
  const solicitar = (chave = randomUUID(), tipo = TIPO_RELATORIO_SKU, origem = busca) => servico.solicitar(escopo, tipo, origem, chave);
  const resposta = { itens: [{ id: "01", produto: "Kit 2 Lenços 70x70cm", tecido: "Fourway", evidencia: "Sedinha" }, { id: "02", produto: "Bandeira Paraná 90x60cm", tecido: "Oxford", evidencia: "Oxford" }, { id: "03", produto: "Tecido Natal", tecido: "Tricoline", evidencia: "Tricoline" }, { id: "04", produto: "Toalha estampada", tecido: "NÃO IDENTIFICADO", evidencia: "" }] };
  return { pg, db, servico, escopo, worker, reservar, solicitar, resposta, app, outroApp, busca };
}

test("fila SQL: geração, revisão separada, publicação, idempotência e isolamento", async t => {
  const f = await fixture(t);
  await assert.rejects(f.solicitar(), /worker.*indisponível/);
  await f.reservar();
  const chave = randomUUID();
  const [a, b] = await Promise.all([f.solicitar(chave), f.solicitar(randomUUID())]);
  assert.equal(a.id, b.id);
  assert.equal((await f.solicitar(chave)).id, a.id);
  assert.deepEqual((await f.servico.listar(f.escopo, TIPO_RELATORIO_SKU, [f.busca])).map(x => x.id), [a.id]);
  await assert.rejects(f.servico.obter({ ...f.escopo, aplicativoId: f.outroApp }, a.id), /não encontrado/);
  await assert.rejects(f.pg.query("DELETE FROM buscas_sku WHERE id=$1", [f.busca]), /RELATORIO_IA_ATIVO/);
  assert.equal((await f.reservar()).trabalho, null); // preparo local
  const geracao = (await f.reservar()).trabalho!;
  assert.equal(geracao.fase, "GERAR"); assert.match(geracao.prompt, /Sedinha/);
  assert.equal((await f.reservar({ ...f.worker, id: "segundo" })).trabalho, null);
  const finalizar = { acao: "finalizar" as const, reserva: geracao.reserva, resultado: f.resposta };
  await f.servico.operar(f.worker, finalizar);
  await f.servico.operar(f.worker, finalizar); // confirmação perdida
  assert.equal((await f.servico.obter(f.escopo, a.id)).processados, 0);
  await assert.rejects(lerRelatorioIa(f.db, f.app, f.busca, undefined, 0), /Nenhum relatório/);
  const revisao = (await f.reservar()).trabalho!;
  assert.equal(revisao.fase, "REVISAR"); assert.notEqual(revisao.reserva, geracao.reserva); assert.match(revisao.prompt, /CANDIDATO_JSON/);
  await f.servico.operar(f.worker, { acao: "finalizar", reserva: revisao.reserva, resultado: f.resposta });
  assert.equal((await f.servico.obter(f.escopo, a.id)).status, "PENDENTE");
  await f.reservar();
  const pronto = await f.servico.obter(f.escopo, a.id); assert.equal(pronto.status, "CONCLUIDO"); assert.equal(pronto.processados, 4);
  assert.ok(!("promptGeracao" in pronto));
  const relatorio = await lerRelatorioIa(f.db, f.app, f.busca, undefined, 0, 2);
  assert.deepEqual(relatorio.itens.map(x => [x.sku, x.quantidade]), [["02", 9], ["01", 5]]);
  assert.equal(relatorio.itens[1].tecido, "Fourway"); assert.equal(relatorio.proximaPagina, 2);
  assert.equal((await f.solicitar(chave)).id, a.id);
  await f.solicitar();
  assert.equal((await lerRelatorioIa(f.db, f.app, f.busca, undefined, 0)).id, a.id);
  await assert.rejects(lerRelatorioIa(f.db, f.outroApp, f.busca, a.id, 0), /Nenhum relatório/);
});

test("falhas: revisão inválida, expiração, retomada do checkpoint e cancelamento", async t => {
  const f = await fixture(t); await f.reservar(); const job = await f.solicitar(); await f.reservar();
  const geracao = (await f.reservar()).trabalho!;
  await f.servico.operar(f.worker, { acao: "finalizar", reserva: geracao.reserva, resultado: f.resposta });
  for (let i = 0; i < 3; i++) {
    const revisao = (await f.reservar()).trabalho!; assert.equal(revisao.fase, "REVISAR");
    await f.servico.operar(f.worker, { acao: "finalizar", reserva: revisao.reserva, resultado: { itens: [] } });
    await f.pg.exec("UPDATE ia_trabalho SET disponivel_em=now()-interval '1 second'");
  }
  assert.equal((await f.servico.obter(f.escopo, job.id)).status, "FALHOU");
  await f.servico.agir(f.escopo, job.id, "retomar");
  const reserva = (await f.reservar()).trabalho!; assert.equal(reserva.fase, "REVISAR");
  await f.pg.exec("UPDATE ia_trabalho SET reserva_ate=now()-interval '1 second'");
  const nova = (await f.reservar()).trabalho!; assert.notEqual(nova.reserva, reserva.reserva);
  await assert.rejects(f.servico.operar(f.worker, { acao: "finalizar", reserva: reserva.reserva, resultado: f.resposta }), /Reserva perdida/);
  await f.servico.agir(f.escopo, job.id, "cancelar");
  await assert.rejects(f.servico.operar(f.worker, { acao: "finalizar", reserva: nova.reserva, resultado: f.resposta }), /Reserva perdida/);
  await f.pg.query("DELETE FROM buscas_sku WHERE id=$1", [f.busca]);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 0);
});

test("permissões são revalidadas e configuração é versionada sem alterar trabalhos existentes", async t => {
  const f = await fixture(t); await f.reservar();
  const cfg = await f.servico.configuracao(f.escopo, TIPO_RELATORIO_SKU); assert.equal(cfg.revisao, 0);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Sedinha = Fourway", 0);
  await assert.rejects(f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "outra", 0), /configuração mudou/);
  const job = await f.solicitar();
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Regra futura", 1);
  await f.reservar(); const reserva = (await f.reservar()).trabalho!;
  assert.match(reserva.prompt, /Sedinha = Fourway/); assert.ok(!reserva.prompt.includes("Regra futura"));
  await f.pg.exec("UPDATE usuario SET pode_escrever_anotar_sku=false");
  assert.deepEqual(await f.servico.operar(f.worker, { acao: "renovar", reserva: reserva.reserva }), { status: "FALHOU" });
  assert.equal((await f.servico.obter(f.escopo, job.id)).status, "FALHOU");
  await assert.rejects(f.servico.agir(f.escopo, job.id, "retomar"), /permissão/);
  await f.pg.exec("UPDATE usuario SET pode_editar_configuracao=false");
  await assert.rejects(f.servico.configuracao(f.escopo, TIPO_RELATORIO_SKU), /permissão/);
  await f.pg.exec("UPDATE usuario SET pode_visualizar_anotar_sku=false");
  await assert.rejects(f.servico.obter(f.escopo, job.id), /permissão/);
});

test("extensão: segundo tipo também exige revisão, com falha local recuperável", async t => {
  let falhar = true, publicacoes = 0;
  const tipo: TipoTrabalhoIa = { ...relatorioSkuIa, tipo: "teste.resumo.v1", schemaSaida: {}, promptGeracao: "gerar teste", promptRevisao: "revisar teste",
    vincular: async () => {}, preparar: async () => { if (falhar) { falhar = false; throw new Error("temporária"); } return { entrada: [{ dado: 1 }], fim: true, cursor: null }; },
    validar: (_entrada, saida) => { assert.deepEqual(saida, { resumo: "certo" }); return [{ resumo: "certo" }]; }, publicar: async () => { publicacoes++; },
  };
  const f = await fixture(t, [relatorioSkuIa, tipo]); await f.reservar(); const job = await f.solicitar(randomUUID(), tipo.tipo); await f.reservar();
  assert.equal((await f.servico.obter(f.escopo, job.id)).status, "AGUARDANDO_RETRY");
  await f.pg.exec("UPDATE ia_trabalho SET disponivel_em=now()-interval '1 second'");
  await f.reservar();
  for (const fase of ["GERAR", "REVISAR"]) { const r = (await f.reservar()).trabalho!; assert.equal(r.fase, fase); await f.servico.operar(f.worker, { acao: "finalizar", reserva: r.reserva, resultado: { resumo: "certo" } }); }
  assert.equal(publicacoes, 0); await f.reservar(); await f.reservar(); assert.equal(publicacoes, 1);
});

test("lotes de 50, entrada mínima, capacidade compatível e RLS", async t => {
  const f = await fixture(t);
  await f.reservar({ ...f.worker, tipos: ["desconhecido"] }); await assert.rejects(f.solicitar(), /worker/);
  await f.reservar();
  await f.pg.query("INSERT INTO itens_busca_sku SELECT $1,$2,'SKU-'||i,'Oxford',i,'1' FROM generate_series(1,102) i", [f.busca, f.app]);
  const job = await f.solicitar(); await f.reservar(); await f.reservar(); await f.reservar();
  const lotes = await f.pg.query<{ tamanho: number }>("SELECT jsonb_array_length(entrada) AS tamanho FROM ia_lote ORDER BY numero");
  assert.deepEqual(lotes.rows.map(x => x.tamanho), [50, 50, 6]);
  assert.equal((await f.servico.obter(f.escopo, job.id)).total, 106);
  const tabelas = await f.pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('ia_trabalho','ia_lote','ia_configuracao')");
  assert.ok(tabelas.rows.every(x => x.relrowsecurity));
  await f.pg.exec("SET ROLE anon"); await assert.rejects(f.pg.query("SELECT * FROM ia_lote"), /permission denied/); await f.pg.exec("RESET ROLE");
});

test("contrato não permite inventar SKU, quantidade, tecido sem evidência ou duplicar itens", () => {
  const entrada = [{ id: "001", titulo: "Kit 2 Sedinha", quantidade: 7 }];
  const valido = { itens: [{ id: "001", produto: "Kit 2", tecido: "Fourway", evidencia: "Sedinha" }] };
  assert.equal(validarRelatorioSkuIa(entrada, valido)[0].quantidade, 7);
  for (const itens of [[], [...valido.itens, ...valido.itens], [{ ...valido.itens[0], id: "999" }], [{ ...valido.itens[0], quantidade: 14 }], [{ ...valido.itens[0], evidencia: "Oxford" }]]) assert.throws(() => validarRelatorioSkuIa(entrada, { itens }));
  assert.throws(() => validarRelatorioSkuIa([{ ...entrada[0], titulo: "" }], valido));
});

test("credencial do worker restringe aplicativo, tipos e grupo", () => {
  const token = "teste-secreto", aplicativoId = randomUUID();
  const config = JSON.stringify([{ id: "vm", aplicativoId, tipos: [TIPO_RELATORIO_SKU], grupo: "vm-1", tokenSha256: createHash("sha256").update(token).digest("hex") }]);
  assert.equal(autenticarWorkerIa(new Request("https://erp", { headers: { Authorization: `Bearer ${token}` } }), config).aplicativoId, aplicativoId);
  assert.throws(() => autenticarWorkerIa(new Request("https://erp", { headers: { Authorization: "Bearer outra" } }), config), /Credencial inválida/);
});

test("executor isolado: contrato, ambiente restrito, limpeza e confirmação idempotente", async () => {
  const trabalho = { reserva: randomUUID(), tipo: TIPO_RELATORIO_SKU, fase: "GERAR" as const, prompt: "dados", schema: { type: "object" }, timeoutMs: 1000 };
  let pasta = "";
  const resultado = await executarTextoCodex(trabalho, new AbortController().signal, async options => {
    pasta = options.cwd!;
    assert.equal(options.stdin, "dados"); assert.ok(options.args.includes("--ignore-user-config"));
    assert.ok(options.args.includes("features.shell_tool=false")); assert.ok(!options.args.some(x => x.includes("browser")));
    assert.equal(options.env?.TRABALHOS_IA_WORKER_TOKEN, undefined);
    await writeFile(options.args[options.args.indexOf("--output-last-message") + 1], '{"itens":[]}');
    return { stdout: "", stderr: "" };
  });
  assert.deepEqual(resultado, { itens: [] }); await assert.rejects(readFile(`${pasta}/resultado.json`));
  let chamadas = 0;
  await consumirEtapaIa({ trabalho, iniciadaEm: performance.now(), signal: new AbortController().signal, executar: async () => resultado, api: async op => { assert.equal(op.acao, "finalizar"); if (++chamadas === 1) throw new Error("rede"); return { ok: true }; } });
  assert.equal(chamadas, 2);
  const cancelado = new AbortController(); cancelado.abort();
  await consumirEtapaIa({ trabalho, iniciadaEm: performance.now(), signal: cancelado.signal, executar: async () => { assert.fail("Não pode iniciar Codex depois de cancelado"); }, api: async () => { assert.fail("Não pode confirmar depois de cancelado"); } });
});

test("limites de fila também valem na retomada; worker antigo não admite novos trabalhos", async t => {
  const f = await fixture(t); await f.reservar(); const job = await f.solicitar();
  await f.pg.query("UPDATE ia_trabalho SET status='FALHOU' WHERE id=$1", [job.id]);
  // Simula 20 outras solicitações válidas; não executa o provedor.
  await f.pg.query(`INSERT INTO ia_trabalho(aplicativo_id,solicitado_por,tipo,origem_id,chave,prompt_geracao,prompt_revisao,prompt_personalizado,revisao_config)
    SELECT $1,$2,'anotar_sku.relatorio.v1',gen_random_uuid(),gen_random_uuid(),'g','r','p',0 FROM generate_series(1,20)`, [f.app, f.escopo.id]);
  await assert.rejects(f.servico.agir(f.escopo, job.id, "retomar"), /20 trabalhos/);
  await assert.rejects(f.solicitar(), /20 trabalhos/);
  await f.pg.exec("UPDATE ia_worker SET contato_em=now()-interval '4 minutes'");
  await assert.rejects(f.solicitar(), /worker.*indisponível/);
});

test("grupo impede duas VMs de executar juntas e credencial não conclui reserva alheia", async t => {
  const f = await fixture(t); await f.reservar(); await f.solicitar(); await f.reservar();
  const trabalho = (await f.reservar()).trabalho!;
  const outro = { ...f.worker, id: "worker-outro-app", aplicativoId: f.outroApp };
  await f.pg.query(`INSERT INTO ia_trabalho(aplicativo_id,solicitado_por,tipo,origem_id,chave,prompt_geracao,prompt_revisao,prompt_personalizado,revisao_config)
    VALUES ($1,$2,'anotar_sku.relatorio.v1',gen_random_uuid(),gen_random_uuid(),'g','r','p',0)`, [f.outroApp, f.escopo.id]);
  assert.equal((await f.reservar(outro)).trabalho, null);
  assert.equal((await f.pg.query<{ status: string }>("SELECT status FROM ia_trabalho WHERE aplicativo_id=$1", [f.outroApp])).rows[0].status, "PENDENTE");
  await assert.rejects(f.servico.operar(outro, { acao: "finalizar", reserva: trabalho.reserva, resultado: f.resposta }), /Reserva inválida/);
});
