import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { criarServicoRetornoOlist } from "../src/lib/retorno-estoque-olist-service";

// Exige banco descartável vazio. Nunca utiliza URLs dos ambientes da aplicação.
const url = process.env.RETORNO_OLIST_TEST_DATABASE_URL;
test("migração, RLS, transação e concorrência dos retornos em banco isolado", { skip: !url }, async (t) => {
  const endereco = new URL(url!);
  assert.ok(["localhost", "127.0.0.1"].includes(endereco.hostname), "Use apenas um banco local descartável.");
  assert.match(endereco.pathname, /^\/retorno_olist_test/);
  const sql = new Client({ connectionString: url });
  await sql.connect();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5 }) });
  t.after(async () => { await db.$disconnect(); await sql.end(); });
  const tabelas = await sql.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'");
  assert.equal(tabelas.rows[0].total, 0, "O banco de teste deve estar vazio.");
  await sql.query(await readFile(new URL("./fixtures/retorno-olist-base.sql", import.meta.url), "utf8"));
  for (const role of ["anon", "authenticated"]) {
    if (!(await sql.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) await sql.query(`CREATE ROLE ${role}`);
  }
  await sql.query(await readFile(new URL("../prisma/migrations/20261021013941_retorno_estoque_olist/migration.sql", import.meta.url), "utf8"));
  const app = await db.aplicativo.create({ data: { nome: "Teste" } });
  const outroApp = await db.aplicativo.create({ data: { nome: "Outro teste" } });
  const usuario = await db.usuario.create({ data: { aplicativoId: app.id, nome: "Responsável teste", email: "teste@example.test" } });
  const produto = await db.produto.create({ data: { aplicativoId: app.id, sku: "SKU-TESTE" } });
  const baixa = await db.baixaEstoqueOlist.create({ data: { aplicativoId: app.id, origem: "automatica" } });
  const saida = await db.movimentacaoEstoque.create({ data: { aplicativoId: app.id, produtoId: produto.id, sku: produto.sku,
    tipoMovimento: "saida", quantidade: 5, origem: "BAIXA_OLIST", referenciaId: baixa.id } });
  const item = await db.itemBaixaEstoqueOlist.create({ data: { aplicativoId: app.id, baixaId: baixa.id, produtoId: produto.id,
    sku: produto.sku, quantidade: 5, pedidoOlistId: "123", itemOlistId: produto.sku, origem: "automatica", movimentacaoId: saida.id } });
  let situacao = 2;
  const service = criarServicoRetornoOlist(db, { listarCancelados: async () => [{ id: "123" }],
    obterPedido: async () => ({ situacao, itens: [{ produto: { sku: produto.sku } }] }) });
  const input = (quantidade: number, chave_idempotencia = crypto.randomUUID()) => ({ chave_idempotencia, itens: [{ item_baixa_id: item.id, quantidade }] });

  await t.test("RLS e grants impedem leitura e escrita direta pelo navegador", async () => {
    const rls = await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('retornos_estoque_olist','itens_retorno_estoque_olist')");
    assert.ok(rls.rows.every((r) => r.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      const grants = await sql.query(`SELECT has_table_privilege($1,'public.retornos_estoque_olist','SELECT,INSERT,UPDATE,DELETE') AS permitido`, [role]);
      assert.equal(grants.rows[0].permitido, false);
      await sql.query(`SET ROLE ${role}`);
      await assert.rejects(sql.query("SELECT * FROM public.retornos_estoque_olist"), /permission denied/);
      await sql.query("RESET ROLE");
    }
  });
  await t.test("retorno parcial, histórico e reenvio preservam a saída original", async () => {
    const envio = input(2);
    const resultado = await service.confirmar(app.id, usuario.id, envio);
    assert.deepEqual(await service.confirmar(app.id, usuario.id, envio), resultado);
    assert.equal((await service.buscar(app.id)).pedidos[0].itens[0].saldo, 3);
    const historico = await service.historico(app.id, 1);
    assert.equal(historico.retornos[0].responsavel, usuario.nome);
    assert.equal(historico.retornos[0].itens[0].pedido_olist_id, "123");
    assert.equal((await db.movimentacaoEstoque.findUniqueOrThrow({ where: { id: saida.id } })).quantidade, 5);
    assert.equal(await db.movimentacaoEstoque.count({ where: { tipoMovimento: "entrada" } }), 1);
    await assert.rejects(service.confirmar(app.id, usuario.id, { ...envio, itens: [{ item_baixa_id: item.id, quantidade: 1 }] }), /Chave/);
  });
  await t.test("pedido reaberto e aplicativo alheio não recebem retorno", async () => {
    situacao = 3; await assert.rejects(service.confirmar(app.id, usuario.id, input(1)), /não está mais cancelado/); situacao = 2;
    await assert.rejects(service.confirmar(outroApp.id, usuario.id, input(1)), /não encontrada/);
    assert.equal(await db.retornoEstoqueOlist.count(), 1);
  });
  await t.test("falha ao gravar item desfaz entrada e cabeçalho da mesma transação", async () => {
    await sql.query(`CREATE FUNCTION falhar_retorno_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END; $$`);
    await sql.query(`CREATE TRIGGER falhar_retorno_teste BEFORE INSERT ON itens_retorno_estoque_olist FOR EACH ROW EXECUTE FUNCTION falhar_retorno_teste()`);
    await assert.rejects(service.confirmar(app.id, usuario.id, input(1)));
    assert.equal(await db.retornoEstoqueOlist.count(), 1);
    assert.equal(await db.movimentacaoEstoque.count({ where: { tipoMovimento: "entrada" } }), 1);
    await sql.query("DROP TRIGGER falhar_retorno_teste ON itens_retorno_estoque_olist; DROP FUNCTION falhar_retorno_teste()");
  });
  await t.test("reenvios simultâneos da mesma chave geram apenas uma entrada", async () => {
    const envio = input(1);
    const [a, b] = await Promise.all([service.confirmar(app.id, usuario.id, envio), service.confirmar(app.id, usuario.id, envio)]);
    assert.equal(a.retorno_id, b.retorno_id);
    assert.equal(await db.retornoEstoqueOlist.count(), 2);
  });
  await t.test("confirmações concorrentes com chaves distintas não ultrapassam saldo", async () => {
    const respostas = await Promise.allSettled([service.confirmar(app.id, usuario.id, input(2)), service.confirmar(app.id, usuario.id, input(2))]);
    assert.equal(respostas.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(respostas.filter((r) => r.status === "rejected").length, 1);
    const total = await db.itemRetornoEstoqueOlist.aggregate({ _sum: { quantidade: true } });
    assert.equal(total._sum.quantidade, 5);
    assert.equal((await service.buscar(app.id)).pedidos[0].estado, "retornado");
    const saldo = await sql.query("SELECT SUM(CASE WHEN tipo_movimento='entrada' THEN quantidade ELSE -quantidade END)::int AS saldo FROM movimentacoes_estoque WHERE produto_id=$1", [produto.id]);
    assert.equal(saldo.rows[0].saldo, 0);
  });
});
