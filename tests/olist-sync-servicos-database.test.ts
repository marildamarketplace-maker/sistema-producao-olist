import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { aplicarMigrationsOlistSync } from "./fixtures/olist-sync-migrations";
import { criarOlistSyncRepository } from "../src/repositories/olist-sync-repository";
import { criarServicoOlistSync } from "../src/services/olist-sync-service";
import { criarClienteSync, type RequisicaoSync, type RespostaHttpSync } from "../src/lib/olist-sync/cliente";
import { criarCriptografiaSync } from "../src/lib/olist-sync/cripto";
import type { CamposSync } from "../src/lib/olist-sync/contrato";

const url = process.env.OLIST_SYNC_SERVICOS_TEST_DATABASE_URL;
test("sincronização de serviços com PostgreSQL e Olist simulada", { skip: !url, timeout: 120_000 }, async t => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname));assert.equal(endereco.pathname, "/olist_sync_test_servicos");
  const sql = new Client({ connectionString: url! });await sql.connect();t.after(() => sql.end());
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 6 }) });t.after(() => db.$disconnect());
  assert.equal((await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'")).rows[0].total, 0);
  await sql.query(`CREATE TABLE aplicativo(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text NOT NULL,jobs text NOT NULL DEFAULT '',aplicativo_pai_id uuid REFERENCES aplicativo(id));
    CREATE TABLE usuario(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aplicativo_id uuid NOT NULL REFERENCES aplicativo(id),ativo boolean NOT NULL DEFAULT true);
    CREATE TABLE configuracoes_jobs(chave text PRIMARY KEY,pausado boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),termos_ignorados_nome_arquivo text[] DEFAULT '{}',variantes_permitidas text[] DEFAULT '{}');
    CREATE TABLE integracao_olist_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;`);
  const pai = "00000000-0000-0000-0000-000000000002", a = "00000000-0000-0000-0000-000000000004", b = "00000000-0000-0000-0000-000000000005", usuario = randomUUID();
  await sql.query("INSERT INTO aplicativo(id,nome) VALUES ($1,'Pai')", [pai]);
  await sql.query("INSERT INTO aplicativo(id,nome,aplicativo_pai_id) VALUES ($1,'A',$3),($2,'B',$3)", [a, b, pai]);
  await aplicarMigrationsOlistSync(sql);
  await sql.query("INSERT INTO usuario(id,aplicativo_id,pode_executar_sincronizacao_olist,pode_configurar_sincronizacao_olist) VALUES ($1,$2,true,true)", [usuario, pai]);
  const repo = criarOlistSyncRepository(db), config = await repo.obterConfiguracao(pai);assert.ok(config);
  const cripto = criarCriptografiaSync({ OLIST_SYNC_DATA_KEY: Buffer.alloc(32, 1).toString("base64"), OLIST_SYNC_HMAC_KEY: Buffer.alloc(32, 2).toString("base64") });
  const contas = new Map<string, Map<string, CamposSync>>(), chamadas: RequisicaoSync[] = [];
  let agora = Date.now(), proximoId = 1000, postIncerto = false, bloquearConfirmacao = false;
  let interceptar: ((requisicao: RequisicaoSync) => Promise<RespostaHttpSync | undefined>) | null = null;
  const normalizarNome = (valor: unknown) => typeof valor === "string" ? valor.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR") : "";
  const cliente = criarClienteSync({
    agora: () => agora,
    configurar: async () => ({ apiBaseUrl: "https://api.tiny.com.br/public-api/v3" }),
    token: async app => app,
    http: async r => {
      chamadas.push(r);const conta = contas.get(r.token)!;const caminho = new URL(r.url);
      if (interceptar) { const resposta = await interceptar(r);if (resposta) return resposta; }
      if (caminho.pathname.endsWith("/info")) return { status: 200, dados: { cpfCnpj: r.token === a ? "04252011000110" : "11222333000181", razaoSocial: `Conta ${r.token}` } };
      assert.ok(caminho.pathname.includes("/servicos"), "Serviços devem usar seu próprio recurso");
      if (r.metodo === "GET" && caminho.pathname.endsWith("/servicos")) {
        const codigo = caminho.searchParams.get("codigo"), nome = caminho.searchParams.get("nome");
        const offset = Number(caminho.searchParams.get("offset") ?? 0), limit = Number(caminho.searchParams.get("limit") ?? 100);
        assert.ok(limit >= 1 && limit <= 100);
        const itens = [...conta.values()].filter(item => (codigo === null || item.codigo === codigo) && (nome === null || normalizarNome(item.nome).includes(normalizarNome(nome))));
        return { status: 200, dados: { itens: itens.slice(offset, offset + limit), paginacao: { total: itens.length, offset, limit } } };
      }
      const id = caminho.pathname.split("/").at(-1)!;
      if (r.metodo === "GET" && r.token === b && bloquearConfirmacao) return { status: 503, dados: {} };
      if (r.metodo === "GET") return conta.has(id) ? { status: 200, dados: conta.get(id) } : { status: 404, dados: {} };
      assert.ok(r.payload && typeof r.payload === "object" && !Array.isArray(r.payload));
      for (const campo of ["preco", "tipoItemSped", "nbs", "codigoListaServicos", "id"]) assert.equal(campo in r.payload, false, `Campo não autorizado: ${campo}`);
      if (r.metodo === "POST") {
        const novoId = proximoId++;conta.set(String(novoId), { id: novoId, situacao: "A", ...r.payload });
        if (postIncerto) { postIncerto = false;throw new Error("Resposta perdida após criação remota simulada"); }
        return { status: 200, dados: { id: novoId, codigo: r.payload.codigo, descricao: r.payload.nome } };
      }
      assert.equal(r.metodo, "PUT");assert.ok(conta.has(id));
      conta.set(id, { ...conta.get(id), ...r.payload });return { status: 204, dados: null };
    },
  });
  const servico = criarServicoOlistSync(db, cliente, { agora: () => new Date(agora), aguardar: async ms => { agora += ms; }, cripto });
  const item = (id: number, codigo: string | null = "001-Ab", nome = "Bordado industrial"): CamposSync => ({ id, codigo, nome, situacao: "A", unidade: "UN", descricaoComplementar: "Aplicação de bordado", observacoes: null, preco: 99, nbs: "123", tipoItemSped: "09", codigoListaServicos: "0101" });
  const escritas = () => chamadas.filter(r => r.metodo !== "GET");
  async function reset() {
    await sql.query("TRUNCATE olist_sync_cobertura,olist_sync_registro,olist_sync_execucao CASCADE");
    await db.configuracaoJob.updateMany({ data: { pausado: false } });
    await db.olistSyncConfiguracao.update({ where: { id: config!.id }, data: { ativo: true, autorizadoPor: usuario, entidades: ["SERVICO"], limiteAlteracoes: 100, proximaExecucaoEm: new Date(Date.now() + 86_400_000), readinessJson: { sincronizacaoNativaCompativel: true, semanticaPutValidada: true } } });
    await db.olistSyncParticipante.updateMany({ where: { configuracaoId: config!.id }, data: { contaIdentidade: null, proximaChamadaEm: null } });
    contas.clear();contas.set(a, new Map());contas.set(b, new Map());chamadas.length = 0;agora = Date.now() + 1000;proximoId = 1000;postIncerto = false;bloquearConfirmacao = false;interceptar = null;
  }
  const enfileirar = (modo: "AUDITAR" | "AUDITAR_E_APLICAR" | "APLICAR" = "AUDITAR_E_APLICAR") => repo.enfileirar({ configuracaoId: config!.id, modo, idempotencia: randomUUID(), solicitadoPor: usuario, origem: "MANUAL", completa: true });
  async function terminar(id: string) {
    for (let i = 0; i < 240; i++) {
      const execucao = await db.olistSyncExecucao.findUniqueOrThrow({ where: { id } });
      if (["CONCLUIDA", "CONCLUIDA_COM_PENDENCIAS", "CANCELADA", "FALHOU"].includes(execucao.status)) return execucao;
      agora += 6_001;const reserva = await repo.reservarEtapa({ agora: new Date(agora) });if (reserva) await servico.processar(reserva);
    }
    assert.fail("A sincronização de serviços não terminou no limite simulado.");
  }

  for (const codigo of ["001-Ab", null]) for (const respostaPerdida of [false, true]) await t.test(`cria e confirma serviço ${codigo === null ? "pelo nome" : "pelo código"}; resposta perdida: ${respostaPerdida}`, async () => {
    await reset();contas.get(a)!.set("10", item(10, codigo));postIncerto = respostaPerdida;
    const e = await enfileirar();assert.equal((await terminar(e.id)).status, "CONCLUIDA");
    assert.equal(escritas().length, 1);assert.equal(escritas()[0].metodo, "POST");assert.equal(contas.get(b)!.size, 1);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status, "CONFIRMADA");
    assert.equal(await db.olistSyncEstado.count(), 2);
    await terminar((await enfileirar()).id);assert.equal(escritas().length, 1, "Uma nova auditoria não pode duplicar o serviço");
  });

  for (const codigo of ["001-Ab", null]) await t.test(`cadastro existente ${codigo === null ? "sem código" : "com mesmo código"} não é criado novamente`, async () => {
    await reset();contas.get(a)!.set("10", item(10, codigo));contas.get(b)!.set("20", item(20, codigo));
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA");assert.equal(escritas().length, 0);
    assert.equal(await db.olistSyncRegistro.count(), 1);
  });

  for (const codigo of ["001-Ab", null]) await t.test(`duplicidade ${codigo === null ? "de nome sem código" : "de código"} na mesma empresa exige revisão`, async () => {
    await reset();contas.get(a)!.set("10", item(10, codigo));contas.get(a)!.set("11", item(11, codigo));
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(await db.olistSyncEstado.count(), 2);
    assert.ok(await db.olistSyncPendencia.count({ where: { status: "AGUARDANDO_REVISAO" } }) > 0);
  });

  await t.test("mesmo nome com código em apenas uma empresa não cria duplicata nem une identidades", async () => {
    await reset();contas.get(a)!.set("10", item(10, "001-Ab"));contas.get(b)!.set("20", item(20, null));
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(contas.get(a)!.size, 1);assert.equal(contas.get(b)!.size, 1);
  });

  await t.test("alteração unilateral de descrição atualiza serviço preservando preço e fiscal locais", async () => {
    await reset();contas.get(a)!.set("10", item(10));contas.get(b)!.set("20", { ...item(20), preco: 49, nbs: "999" });
    await terminar((await enfileirar()).id);assert.equal(escritas().length, 0);
    contas.get(a)!.get("10")!.descricaoComplementar = "Aplicação até 30 cm";
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA");
    assert.equal(escritas().length, 1);assert.equal(escritas()[0].metodo, "PUT");assert.ok(escritas()[0].url.endsWith("/servicos/20"));
    assert.equal(contas.get(b)!.get("20")!.descricaoComplementar, "Aplicação até 30 cm");
    assert.equal(contas.get(b)!.get("20")!.preco, 49);assert.equal(contas.get(b)!.get("20")!.nbs, "999");
  });

  await t.test("inativação de serviço não produz criação ou atualização automática", async () => {
    await reset();contas.get(a)!.set("10", { ...item(10), situacao: "I" });
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA_COM_PENDENCIAS");assert.equal(escritas().length, 0);
  });

  for (const codigoOrigem of ["001-Ab", null]) await t.test(`colisão código versus nome surgida no destino após auditoria bloqueia criação (${codigoOrigem === null ? "origem sem código" : "origem com código"})`, async () => {
    await reset();contas.get(a)!.set("10", item(10, codigoOrigem));
    await terminar((await enfileirar("AUDITAR")).id);assert.equal(await db.olistSyncOperacao.count({ where: { status: "AUTORIZADA" } }), 1);
    contas.get(b)!.set("20", item(20, codigoOrigem === null ? "OUTRO-CODIGO" : null));
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(contas.get(b)!.size, 1);
  });

  await t.test("homônimo sem código criado na origem após auditoria exige revisão antes de enviar", async () => {
    await reset();contas.get(a)!.set("10", item(10, null));await terminar((await enfileirar("AUDITAR")).id);
    contas.get(a)!.set("11", item(11, null));
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(contas.get(b)!.size, 0);
  });

  await t.test("fila existente de serviços pode ser aplicada em execução independente da auditoria", async () => {
    await reset();contas.get(a)!.set("10", item(10));
    await terminar((await enfileirar("AUDITAR")).id);assert.equal(escritas().length, 0);
    const op = await db.olistSyncOperacao.findFirstOrThrow();assert.equal(op.status, "AUTORIZADA");
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA");
    assert.equal(escritas().length, 1);assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: op.id } })).status, "CONFIRMADA");
  });

  await t.test("novo job de aplicação reconcilia POST perdido e confirmação indisponível sem reenviar", async () => {
    await reset();contas.get(a)!.set("10", item(10, null));postIncerto = true;bloquearConfirmacao = true;
    await terminar((await enfileirar()).id);
    const op = await db.olistSyncOperacao.findFirstOrThrow();assert.ok(["EM_APLICACAO", "VERIFICANDO", "RESULTADO_INCONCLUSIVO"].includes(op.status));
    assert.equal(escritas().length, 1);assert.equal(contas.get(b)!.size, 1);
    bloquearConfirmacao = false;
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA");
    assert.equal(escritas().length, 1);assert.equal((await db.olistSyncOperacao.findUniqueOrThrow({ where: { id: op.id } })).status, "CONFIRMADA");
    assert.equal(contas.get(b)!.size, 1);
  });

  await t.test("códigos diferentes com mesmo nome permanecem serviços independentes", async () => {
    await reset();contas.get(a)!.set("10", item(10, "001"));contas.get(b)!.set("20", item(20, "002"));
    assert.equal((await terminar((await enfileirar()).id)).status, "CONCLUIDA");
    assert.equal(escritas().length, 2);assert.equal(contas.get(a)!.size, 2);assert.equal(contas.get(b)!.size, 2);
    assert.deepEqual([...contas.get(a)!.values()].map(s => s.codigo).sort(), ["001", "002"]);
    assert.deepEqual([...contas.get(b)!.values()].map(s => s.codigo).sort(), ["001", "002"]);
  });

  await t.test("código duplicado na origem após auditoria bloqueia envio", async () => {
    await reset();contas.get(a)!.set("10", item(10));await terminar((await enfileirar("AUDITAR")).id);
    contas.get(a)!.set("11", item(11));
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(contas.get(b)!.size, 0);
  });

  await t.test("código duplicado no destino após auditoria bloqueia atualização", async () => {
    await reset();contas.get(a)!.set("10", item(10));contas.get(b)!.set("20", item(20));
    await terminar((await enfileirar()).id);contas.get(a)!.get("10")!.descricaoComplementar = "Mudança autorizada";
    await terminar((await enfileirar("AUDITAR")).id);contas.get(b)!.set("21", item(21));
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.equal(escritas().length, 0);assert.equal(contas.get(b)!.get("20")!.descricaoComplementar, "Aplicação de bordado");
  });

  for (const desfecho of ["E", "404"]) await t.test(`serviço sem identificação ${desfecho === "E" ? "excluído" : "removido"} encerra sua pendência e não a reabre`, async () => {
    await reset();contas.get(a)!.set("10", { ...item(10, null), nome: null });
    await terminar((await enfileirar("AUDITAR")).id);
    const pendencia = await db.olistSyncPendencia.findFirstOrThrow({ where: { aplicativoId: a, tipo: "IDENTIDADE_REQUER_REVISAO" } });
    assert.equal(pendencia.status, "AGUARDANDO_REVISAO");
    if (desfecho === "E") contas.get(a)!.get("10")!.situacao = "E";
    else contas.get(a)!.delete("10");
    await terminar((await enfileirar("AUDITAR")).id);
    const encerrada = await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: pendencia.id } });
    assert.equal(encerrada.status, "RESOLVIDA");assert.ok(encerrada.decididoEm);
    assert.equal((await db.olistSyncEstado.findFirstOrThrow({ where: { aplicativoId: a } })).presente, false);
    await terminar((await enfileirar("AUDITAR")).id);
    const repetida = await db.olistSyncPendencia.findUniqueOrThrow({ where: { id: pendencia.id } });
    assert.equal(repetida.status, "RESOLVIDA");assert.equal(repetida.versao, encerrada.versao);
    assert.equal(escritas().length, 0);assert.equal(await db.olistSyncRegistro.count(), 0);
  });

  for (const alvo of ["fonte", "destino"] as const) for (const alteracao of ["campos", "situacao"] as const) await t.test(`última busca por chave revalida ${alteracao} da ${alvo} após detalhe`, async () => {
    await reset();contas.get(a)!.set("10", item(10));contas.get(b)!.set("20", item(20));
    await terminar((await enfileirar()).id);
    contas.get(a)!.get("10")!.descricaoComplementar = "Mudança aprovada";
    await terminar((await enfileirar("AUDITAR")).id);
    const app = alvo === "fonte" ? a : b, id = alvo === "fonte" ? "10" : "20";let alterou = false;
    interceptar = async r => {
      const u = new URL(r.url);
      if (!alterou && r.token === app && r.metodo === "GET" && u.pathname.endsWith("/servicos") && u.searchParams.get("codigo") === "001-Ab") {
        alterou = true;
        if (alteracao === "campos") contas.get(app)!.get(id)!.descricaoComplementar = "Edição externa concorrente";
        else contas.get(app)!.get(id)!.situacao = "I";
      }
      return undefined;
    };
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.ok(alterou);assert.equal(escritas().length, 0);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).erroCodigo, alvo === "fonte" ? "FONTE_ALTERADA" : "DESTINO_ALTERADO");
    assert.equal(contas.get(b)!.get("20")!.descricaoComplementar, alvo === "destino" && alteracao === "campos" ? "Edição externa concorrente" : "Aplicação de bordado");
  });

  await t.test("429 longo na validação da chave de destino renova pré-condições sem invalidar a proposta", async () => {
    await reset();contas.get(a)!.set("10", item(10));contas.get(b)!.set("20", item(20));
    await terminar((await enfileirar()).id);contas.get(a)!.get("10")!.descricaoComplementar = "Mudança aprovada";
    await terminar((await enfileirar("AUDITAR")).id);let limitada = false;
    const inicio = chamadas.length;
    interceptar = async r => {
      const u = new URL(r.url);
      if (!limitada && r.token === b && r.metodo === "GET" && u.pathname.endsWith("/servicos") && u.searchParams.get("codigo") === "001-Ab") {
        limitada = true;return { status: 429, dados: {}, retryAfter: "180" };
      }
      return undefined;
    };
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA");
    assert.ok(limitada);assert.equal(escritas().length, 1);assert.equal(escritas()[0].metodo, "PUT");
    assert.ok(chamadas.slice(inicio).filter(r => r.token === a && r.metodo === "GET" && r.url.endsWith("/servicos/10")).length >= 2, "A fonte deve ser relida depois da cota longa");
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).status, "CONFIRMADA");
  });

  await t.test("concorrente com mesmo código surgido na sonda por nome impede POST duplicado", async () => {
    await reset();contas.get(a)!.set("10", item(10));await terminar((await enfileirar("AUDITAR")).id);let criouConcorrente = false;
    interceptar = async r => {
      const u = new URL(r.url);
      if (!criouConcorrente && r.token === b && r.metodo === "GET" && u.pathname.endsWith("/servicos") && u.searchParams.has("nome")) {
        criouConcorrente = true;contas.get(b)!.set("20", item(20));
      }
      return undefined;
    };
    assert.equal((await terminar((await enfileirar("APLICAR")).id)).status, "CONCLUIDA_COM_PENDENCIAS");
    assert.ok(criouConcorrente);assert.equal(escritas().length, 0);assert.equal(contas.get(b)!.size, 1);
    assert.equal((await db.olistSyncOperacao.findFirstOrThrow()).erroCodigo, "POSSIVEL_DUPLICIDADE");
  });
});
