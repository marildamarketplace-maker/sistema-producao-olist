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
import { solicitarRelatorioSkuAutomatico } from "../src/lib/trabalhos-ia/automatico-sku";
import type { ColunaOrdenacaoSku } from "../src/lib/anotar-sku/ordenacao";

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
  await pg.exec(await readFile(new URL("../prisma/migrations/20261120222700_relatorio_ia_automatico/migration.sql", import.meta.url), "utf8"));
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
  const outroUsuario = randomUUID();
  await f.pg.query("INSERT INTO usuario(id,aplicativo_id) VALUES($1,$2)", [outroUsuario, f.app]);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Regras para buscas futuras", 0);
  await f.pg.exec("DELETE FROM ia_worker");
  const repetidos = await Promise.all([
    f.solicitar(),
    f.servico.solicitar({ id: outroUsuario, aplicativoId: f.app }, TIPO_RELATORIO_SKU, f.busca, randomUUID()),
  ]);
  assert.ok(repetidos.every(t => t.id === a.id && t.status === "CONCLUIDO" && t.revisaoConfig === 0));
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 1, "Outra chave, usuário ou configuração não refaz a mesma busca");
  assert.equal((await f.pg.query("SELECT id FROM ia_tentativa")).rows.length, 4, "Reaproveitar não cria etapas nem exige worker online");
  await f.pg.query("UPDATE usuario SET pode_escrever_anotar_sku=false WHERE id=$1", [outroUsuario]);
  await assert.rejects(f.servico.solicitar({ id: outroUsuario, aplicativoId: f.app }, TIPO_RELATORIO_SKU, f.busca, randomUUID()), /permissão/);
  assert.equal((await lerRelatorioIa(f.db, f.app, f.busca, undefined, 0)).id, a.id);
  await assert.rejects(lerRelatorioIa(f.db, f.outroApp, f.busca, a.id, 0), /Nenhum relatório/);
});

test("relatório ordena todas as colunas globalmente antes de paginar, entre lotes e com desempate estável", async t => {
  const f = await fixture(t); await f.reservar(); const job = await f.solicitar();
  const ids = Array.from({ length: 55 }, (_, i) => String(i + 1).padStart(3, "0"));
  const itens = ids.map((sku, i) => ({ sku, produto: `Produto ${String(55 - i).padStart(3, "0")}`, tecido: i < 27 ? "Oxford" : "Fourway", quantidade: i + 1 }));
  for (let lote = 0; lote < 2; lote++) {
    const linhas = itens.filter((_, i) => i % 2 === lote);
    await f.pg.query("INSERT INTO ia_lote(trabalho_id,aplicativo_id,numero,entrada,candidato,revisado,resultado) VALUES($1,$2,$3,$4,$5,$5,$5)", [job.id, f.app, lote, JSON.stringify(linhas.map(item => ({ id: item.sku, sku: item.sku, titulo: item.produto, quantidade: item.quantidade }))), JSON.stringify(linhas)]);
  }
  await f.pg.query("UPDATE ia_trabalho SET status='CONCLUIDO',total=55,processados=55,finalizado_em=now() WHERE id=$1", [job.id]);
  const esperados: Record<ColunaOrdenacaoSku, string[]> = {
    sku: ids, produto: [...ids].reverse(), quantidade: ids,
    tecido: [...ids.slice(27).reverse(), ...ids.slice(0, 27).reverse()],
  };
  for (const coluna of ["sku", "produto", "tecido", "quantidade"] as const) for (const direcao of ["asc", "desc"] as const) {
    const recebidos: string[] = [];
    for (const offset of [0, 20, 40]) {
      const pagina = await lerRelatorioIa(f.db, f.app, f.busca, job.id, offset, 20, { coluna, direcao });
      assert.ok(pagina.itens.length <= 20);
      assert.equal(pagina.proximaPagina, offset < 40 ? offset + 20 : null);
      recebidos.push(...pagina.itens.map(item => item.sku));
    }
    const esperado = coluna === "tecido" && direcao === "desc"
      ? [...ids.slice(0, 27).reverse(), ...ids.slice(27).reverse()]
      : direcao === "desc" ? [...esperados[coluna]].reverse() : esperados[coluna];
    assert.deepEqual(recebidos, esperado, `${coluna} ${direcao}: sem repetir ou omitir SKUs entre páginas`);
  }
  assert.equal((await lerRelatorioIa(f.db, f.app, f.busca, job.id, 0)).itens[0].quantidade, 55);
  await assert.rejects(lerRelatorioIa(f.db, f.outroApp, f.busca, job.id, 0, 50, { coluna: "produto", direcao: "asc" }), /Nenhum relatório/);
});

test("configuração automática: opt-in, revisão otimista, compatibilidade e isolamento", async t => {
  const f = await fixture(t);
  assert.equal((await f.servico.configuracao(f.escopo, TIPO_RELATORIO_SKU)).gerarAutomaticamente, false);
  const automatico = () => f.servico.solicitarAutomatico(f.escopo, TIPO_RELATORIO_SKU, f.busca, randomUUID());
  assert.equal(await automatico(), null);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 0, true);
  await assert.rejects(f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 0, false), /configuração mudou/);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Sedinha = Fourway", 1);
  assert.equal((await f.servico.configuracao(f.escopo, TIPO_RELATORIO_SKU)).gerarAutomaticamente, true, "Cliente antigo não desativa a preferência");
  assert.equal(await f.servico.solicitarAutomatico({ ...f.escopo, aplicativoId: f.outroApp }, TIPO_RELATORIO_SKU, f.busca, randomUUID()), null);
  await f.pg.exec("UPDATE usuario SET pode_visualizar_anotar_sku=false");
  assert.equal(await automatico(), null, "Autoridade da busca não concede permissão IA");
  await assert.rejects(f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 2, false), /permissão/);
  await f.pg.exec("UPDATE usuario SET pode_visualizar_anotar_sku=true");
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 2, false);
  assert.equal(await automatico(), null);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 0);
});

test("conclusão automática persiste offline e compartilha a deduplicação e o consumidor manual", async t => {
  const f = await fixture(t);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Sedinha = Fourway", 0, true);
  const chave = randomUUID();
  const [a, b] = await Promise.all([
    f.servico.solicitarAutomatico(f.escopo, TIPO_RELATORIO_SKU, f.busca, chave),
    f.servico.solicitarAutomatico(f.escopo, TIPO_RELATORIO_SKU, f.busca, chave),
  ]);
  assert.ok(a); assert.equal(a.id, b?.id); assert.equal(a.status, "PENDENTE");
  assert.equal((await f.solicitar()).id, a.id, "Clique manual reutiliza o pedido automático mesmo com VM offline");
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Regras futuras", 1, false);
  assert.equal((await f.servico.obter(f.escopo, a.id)).status, "PENDENTE", "Desativar não cancela solicitações já registradas");
  await f.reservar();
  for (const fase of ["GERAR", "REVISAR"]) {
    const r = (await f.reservar()).trabalho!; assert.equal(r.fase, fase); assert.match(r.prompt, /Sedinha = Fourway/);
    await f.servico.operar(f.worker, { acao: "finalizar", reserva: r.reserva, resultado: f.resposta });
  }
  await f.reservar();
  assert.equal((await f.servico.obter(f.escopo, a.id)).status, "CONCLUIDO");
  assert.equal((await lerRelatorioIa(f.db, f.app, f.busca, undefined, 0)).itens.length, 4);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 2, true);
  assert.equal((await f.servico.solicitarAutomatico(f.escopo, TIPO_RELATORIO_SKU, f.busca, randomUUID()))?.id, a.id);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 1);
});

test("evento automático não é perdido com fila manual cheia e não amplia concorrência", async t => {
  const f = await fixture(t); await f.reservar();
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 0, true);
  await f.pg.query(`INSERT INTO ia_trabalho(aplicativo_id,solicitado_por,tipo,origem_id,chave,prompt_geracao,prompt_revisao,prompt_personalizado,revisao_config)
    SELECT $1,$2,'anotar_sku.relatorio.v1',gen_random_uuid(),gen_random_uuid(),'g','r','p',0 FROM generate_series(1,20)`, [f.app, f.escopo.id]);
  await assert.rejects(f.solicitar(), /20 trabalhos/);
  const criado = await f.servico.solicitarAutomatico(f.escopo, TIPO_RELATORIO_SKU, f.busca, randomUUID());
  assert.equal(criado?.status, "PENDENTE");
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 21);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho WHERE status='PROCESSANDO'")).rows.length, 0);
});

test("solicitação automática participa do commit e rollback da transação da busca", async t => {
  const f = await fixture(t);
  await f.servico.configurar(f.escopo, TIPO_RELATORIO_SKU, "Oxford", 0, true);
  const novaBusca = randomUUID(), chave = randomUUID();
  async function concluir(falhar: boolean) {
    return f.db.transacao(async sql => {
      await sql.executar(Prisma.sql`INSERT INTO buscas_sku VALUES (${novaBusca}::uuid,${f.app}::uuid)`);
      await sql.executar(Prisma.sql`INSERT INTO itens_busca_sku VALUES (${novaBusca}::uuid,${f.app}::uuid,'A','Oxford',1,'3')`);
      const tx = { $queryRaw: <T>(q: Prisma.Sql) => sql.consultar<T>(q), $executeRaw: (q: Prisma.Sql) => sql.executar(q) } as unknown as Prisma.TransactionClient;
      const trabalho = await solicitarRelatorioSkuAutomatico(tx, f.escopo, novaBusca, chave);
      if (falhar) throw new Error("Falha ao concluir a busca");
      return trabalho;
    });
  }
  await assert.rejects(concluir(true), /Falha ao concluir/);
  assert.equal((await f.pg.query("SELECT id FROM buscas_sku WHERE id=$1", [novaBusca])).rows.length, 0);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 0);
  assert.ok(await concluir(false));
  assert.equal((await f.pg.query("SELECT id FROM buscas_sku WHERE id=$1", [novaBusca])).rows.length, 1);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 1);
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
  const aposCancelamento = await f.solicitar();
  assert.notEqual(aposCancelamento.id, job.id, "Sem relatório concluído, cancelamento permite nova solicitação");
  await f.servico.agir(f.escopo, aposCancelamento.id, "cancelar");
  await f.pg.query("DELETE FROM buscas_sku WHERE id=$1", [f.busca]);
  assert.equal((await f.pg.query("SELECT id FROM ia_trabalho")).rows.length, 0);
});

test("relatório único bloqueia retomada e consumo de gerações legadas quando já há conclusão", async t => {
  const f = await fixture(t); await f.reservar();
  const antigo = await f.solicitar();
  await f.pg.query("UPDATE ia_trabalho SET status='FALHOU' WHERE id=$1", [antigo.id]);
  const pronto = await f.solicitar();
  await f.pg.query("UPDATE ia_trabalho SET status='CONCLUIDO',finalizado_em=now() WHERE id=$1", [pronto.id]);
  await assert.rejects(f.servico.agir(f.escopo, antigo.id, "retomar"), /já possui um relatório/);
  assert.equal((await f.servico.obter(f.escopo, antigo.id)).status, "FALHOU");
  // Simula uma geração da versão anterior que já estava na fila no deploy.
  await f.pg.query("UPDATE ia_trabalho SET status='PENDENTE',fase='PUBLICAR' WHERE id=$1", [antigo.id]);
  assert.equal((await f.reservar()).trabalho, null);
  assert.equal((await f.servico.obter(f.escopo, antigo.id)).status, "CANCELADO");
  assert.deepEqual((await f.pg.query<{ id: string }>("SELECT id FROM ia_trabalho WHERE status='CONCLUIDO'")).rows.map(t => t.id), [pronto.id]);
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
  const tipo: TipoTrabalhoIa = { ...relatorioSkuIa, reutilizarConcluido: false, tipo: "teste.resumo.v1", schemaSaida: {}, promptGeracao: "gerar teste", promptRevisao: "revisar teste",
    vincular: async () => {}, preparar: async () => { if (falhar) { falhar = false; throw new Error("temporária"); } return { entrada: [{ dado: 1 }], fim: true, cursor: null }; },
    validar: (_entrada, saida) => { assert.deepEqual(saida, { resumo: "certo" }); return [{ resumo: "certo" }]; }, publicar: async () => { publicacoes++; },
  };
  const f = await fixture(t, [relatorioSkuIa, tipo]); await f.reservar(); const job = await f.solicitar(randomUUID(), tipo.tipo); await f.reservar();
  assert.equal((await f.servico.obter(f.escopo, job.id)).status, "AGUARDANDO_RETRY");
  await f.pg.exec("UPDATE ia_trabalho SET disponivel_em=now()-interval '1 second'");
  await f.reservar();
  for (const fase of ["GERAR", "REVISAR"]) { const r = (await f.reservar()).trabalho!; assert.equal(r.fase, fase); await f.servico.operar(f.worker, { acao: "finalizar", reserva: r.reserva, resultado: { resumo: "certo" } }); }
  assert.equal(publicacoes, 0); await f.reservar(); await f.reservar(); assert.equal(publicacoes, 1);
  assert.notEqual((await f.solicitar(randomUUID(), tipo.tipo)).id, job.id, "Tipos sem política de reutilização mantêm novas execuções");
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
