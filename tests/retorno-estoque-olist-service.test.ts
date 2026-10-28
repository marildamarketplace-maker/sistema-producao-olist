import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { criarServicoRetornoOlist } from "../src/lib/retorno-estoque-olist-service";
import type { BaixaRetorno, ConfirmarRetornoInput } from "../src/lib/retorno-estoque-olist-domain";

const app = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const outroId = "20000000-0000-4000-8000-000000000002";
const chave = "30000000-0000-4000-8000-000000000001";
function ambiente(skusVendidos = ["SKU", "SKU-2"]) {
  const baixas: BaixaRetorno[] = [ { id, aplicativoId: app, produtoId: "produto", sku: "SKU", quantidade: 5,
    pedidoOlistId: "123", movimentacaoId: "saida", retornos: [] },
  { id: outroId, aplicativoId: app, produtoId: "produto2", sku: "SKU-2", quantidade: 3,
    pedidoOlistId: "123", movimentacaoId: "saida2", retornos: [] } ];
  const saidas = baixas.map((baixa) => ({ id: baixa.movimentacaoId!, aplicativoId: app,
    produtoId: baixa.produtoId!, sku: baixa.sku, quantidade: baixa.quantidade, tipoMovimento: "saida" }));
  type Retorno = { id: string; aplicativoId: string; chaveIdempotencia: string; payloadHash: string; itens: { quantidade: number }[] };
  let retornos: Retorno[] = [];
  let entradas: { id: string; quantidade: number; tipoMovimento: string; origem: string; aplicativoId: string; sku: string }[] = [];
  let erroOlist = false, situacao = 2, erroGravacao = false, chamadasOlist = 0;
  let listados = ["123", "456"];
  const bloqueios: string[] = [];
  const db = {
    itemBaixaEstoqueOlist: { findMany: async ({ where }: { where: { aplicativoId: string; id?: { in: string[] }; pedidoOlistId?: { in: string[] } } }) => {
      assert.equal(where.aplicativoId, app);
      return baixas.filter((baixa) => baixa.aplicativoId === where.aplicativoId
        && (!where.id || where.id.in.includes(baixa.id)) && (!where.pedidoOlistId || where.pedidoOlistId.in.includes(baixa.pedidoOlistId!)));
    } },
    movimentacaoEstoque: {
      findMany: async () => saidas,
      findFirst: async ({ where }: { where: { id: string } }) => saidas.find((saida) => saida.id === where.id),
      create: async ({ data }: { data: Omit<(typeof entradas)[number], "id"> }) => {
        const movimento = { id: `entrada-${entradas.length}`, ...data }; entradas.push(movimento); return movimento;
      },
    },
    produto: { findMany: async () => baixas.map((baixa) => ({ id: baixa.produtoId, sku: baixa.sku })), findFirst: async () => ({ id: "produto" }) },
    retornoEstoqueOlist: {
      findUnique: async ({ where }: { where: { aplicativoId_chaveIdempotencia: { aplicativoId: string; chaveIdempotencia: string } } }) => {
        const filtro = where.aplicativoId_chaveIdempotencia;
        return retornos.find((retorno) => retorno.aplicativoId === filtro.aplicativoId && retorno.chaveIdempotencia === filtro.chaveIdempotencia);
      },
      create: async ({ data }: { data: Omit<Retorno, "id" | "itens"> }) => { const retorno = { id: `retorno-${retornos.length}`, ...data, itens: [] }; retornos.push(retorno); return retorno; },
    },
    itemRetornoEstoqueOlist: { create: async ({ data }: { data: { itemBaixaId: string; retornoId: string; quantidade: number } }) => {
      if (erroGravacao) throw new Error("falha de gravação");
      baixas.find((baixa) => baixa.id === data.itemBaixaId)!.retornos.push({ quantidade: data.quantidade });
      retornos.find((retorno) => retorno.id === data.retornoId)!.itens.push({ quantidade: data.quantidade });
    } },
    $queryRaw: async (sql: unknown) => {
      const texto = Array.isArray(sql) ? sql.join("?") : (sql as { sql: string }).sql;
      bloqueios.push(texto);
      return [];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ retornos, entradas, baixas });
      try { return await fn(db); }
      catch (error) {
        retornos = snapshot.retornos; entradas = snapshot.entradas;
        baixas.splice(0, baixas.length, ...snapshot.baixas); throw error;
      }
    },
  };
  const service = criarServicoRetornoOlist(db as unknown as PrismaClient, {
    listarCancelados: async () => { if (erroOlist) throw new Error("429"); return listados.map((id) => ({ id })); },
    obterPedido: async () => { chamadasOlist++; if (erroOlist) throw new Error("429"); return { situacao,
      itens: skusVendidos.map((sku) => ({ produto: { sku } })) }; },
  });
  const input = (quantidade = 2, chave_idempotencia = chave): ConfirmarRetornoInput => ({ chave_idempotencia, itens: [{ item_baixa_id: id, quantidade }] });
  return { service, baixas, bloqueios, input,
    get entradas() { return entradas; }, get retornos() { return retornos; }, get chamadasOlist() { return chamadasOlist; },
    erroOlist: () => { erroOlist = true; }, reabrirPedido: () => { situacao = 3; }, erroGravacao: () => { erroGravacao = true; },
    listar: (ids: string[]) => { listados = ids; },
  };
}

test("busca separa elegíveis, sem baixa e retornados sem movimentar estoque", async () => {
  const a = ambiente();
  let busca = await a.service.buscar(app, "2026-10-20");
  assert.deepEqual(busca.pedidos.map((p) => [p.id, p.estado]), [["123", "elegivel"], ["456", "sem_baixa"]]);
  assert.equal(busca.pedidos[0].itens.length, 2);
  assert.equal(a.entradas.length, 0);
  a.baixas.forEach((baixa) => { baixa.retornos = [{ quantidade: baixa.quantidade }]; });
  busca = await a.service.buscar(app);
  assert.equal(busca.pedidos[0].estado, "retornado");
});

test("saída do mesmo SKU em outro pedido não torna o cancelado elegível", async () => {
  const a = ambiente(); a.listar(["789"]);
  assert.equal((await a.service.buscar(app)).pedidos[0].estado, "sem_baixa");
});

test("falhas Olist e vínculos inválidos nunca aparecem como ausência de baixa", async () => {
  const a = ambiente(); a.erroOlist(); await assert.rejects(a.service.buscar(app), /consulta Olist/);
  const b = ambiente(); b.baixas[0].movimentacaoId = null;
  assert.equal((await b.service.buscar(app)).pedidos[0].estado, "pendente");
  const c = ambiente(); c.reabrirPedido();
  assert.equal((await c.service.buscar(app)).pedidos[0].estado, "pendente");
});

test("retorno parcial cria entrada vinculada e reenvio idempotente não duplica", async () => {
  const a = ambiente();
  const primeiro = await a.service.confirmar(app, "usuario", a.input());
  assert.equal(primeiro.quantidade, 2);
  assert.equal(a.entradas[0].origem, "RETORNO_CANCELAMENTO_OLIST");
  assert.equal(a.entradas[0].tipoMovimento, "entrada");
  assert.equal(a.entradas[0].aplicativoId, app);
  assert.match(a.bloqueios[0], /pg_advisory_xact_lock/);
  assert.match(a.bloqueios[1], /ORDER BY id FOR UPDATE/);
  assert.equal((await a.service.buscar(app)).pedidos[0].itens[0].saldo, 3);
  a.erroOlist(); // Um reenvio aceito anteriormente não depende da disponibilidade atual da Olist.
  assert.deepEqual(await a.service.confirmar(app, "usuario", a.input()), primeiro);
  assert.equal(a.entradas.length, 1);
  await assert.rejects(a.service.confirmar(app, "usuario", a.input(3)), /Chave.*outros itens/);
});

test("limita retorno ao saldo restante e mantém dados atômicos em falhas", async () => {
  const a = ambiente(); await a.service.confirmar(app, "usuario", a.input(2));
  await assert.rejects(a.service.confirmar(app, "usuario", a.input(4, "40000000-0000-4000-8000-000000000001")), /saldo disponível/);
  assert.equal(a.entradas.length, 1); assert.equal(a.retornos.length, 1);
  const b = ambiente(); b.erroGravacao();
  await assert.rejects(b.service.confirmar(app, "usuario", b.input()), /falha de gravação/);
  assert.equal(b.entradas.length, 0); assert.equal(b.retornos.length, 0); assert.equal(b.baixas[0].retornos.length, 0);
});

test("status alterado, Olist indisponível ou ID de outro aplicativo impedem entrada", async () => {
  const a = ambiente(); a.reabrirPedido(); await assert.rejects(a.service.confirmar(app, "usuario", a.input()), /não está mais cancelado/);
  const b = ambiente(); b.erroOlist(); await assert.rejects(b.service.confirmar(app, "usuario", b.input()), /revalidar/);
  const c = ambiente(); c.baixas[0].aplicativoId = "outro"; await assert.rejects(c.service.confirmar(app, "usuario", c.input()), /não encontrada/);
  for (const ambiente of [a, b, c]) assert.equal(ambiente.entradas.length, 0);
});

test("perda na entrega registra retorno sem entrada e consome saldo com idempotência", async () => {
  const a = ambiente();
  const input = { ...a.input(5), itens: [{ item_baixa_id: id, quantidade: 5, perdido_na_entrega: true as const }] };
  const primeiro = await a.service.confirmar(app, "usuario", input);
  assert.equal(primeiro.quantidade, 5);
  assert.equal(a.entradas.length, 0);
  assert.equal(a.retornos.length, 1);
  assert.equal((await a.service.buscar(app)).pedidos[0].itens[0].saldo, 0);
  assert.deepEqual(await a.service.confirmar(app, "usuario", input), primeiro);
  await assert.rejects(a.service.confirmar(app, "usuario", a.input(5)), /Chave/);
  await assert.rejects(a.service.confirmar(app, "usuario", a.input(1, "40000000-0000-4000-8000-000000000001")), /saldo disponível/);
  assert.equal(a.entradas.length, 0);
});

test("confirmação mista cria entrada apenas dos itens recebidos", async () => {
  const a = ambiente();
  await a.service.confirmar(app, "usuario", { ...a.input(), itens: [
    { item_baixa_id: id, quantidade: 2, perdido_na_entrega: true },
    { item_baixa_id: outroId, quantidade: 3 },
  ] });
  assert.equal(a.entradas.length, 1);
  assert.equal(a.entradas[0].sku, "SKU-2");
  assert.equal(a.entradas[0].quantidade, 3);
});

test("cancelamento de kit valida o SKU vendido e retorna o componente originalmente baixado", async () => {
  const a = ambiente(["KIT"]);
  a.baixas.forEach((baixa) => { baixa.skuOrigem = "KIT"; });
  const busca = await a.service.buscar(app);
  assert.equal(busca.pedidos[0].estado, "elegivel");
  assert.deepEqual(busca.pedidos[0].itens.map((item) => item.sku), ["SKU", "SKU-2"]);
  await a.service.confirmar(app, "usuario", a.input());
  assert.equal(a.entradas[0].sku, "SKU");
  assert.equal(a.entradas[0].quantidade, 2);
});
