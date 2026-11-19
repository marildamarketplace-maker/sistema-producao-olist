import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

test("resultado e exportações ordenam pela quantidade total de cada SKU", async t => {
  const aplicativoId = "11111111-1111-4111-8111-111111111111";
  const buscaId = "22222222-2222-4222-8222-222222222222";
  const usuario = { id: "usuario-teste", aplicativoId, ativo: true, podeVisualizarAnotarSku: true };
  const itens = [
    { pedidoOlistId: "1", sku: "SKU10", tituloProduto: "Lenço", quantidade: 3 },
    { pedidoOlistId: "1", sku: "AGREGADO", tituloProduto: "Zebra", quantidade: 2 },
    { pedidoOlistId: "1", sku: "MAIOR", tituloProduto: "Último no alfabeto", quantidade: 10 },
    { pedidoOlistId: "1", sku: "SEM-TITULO", tituloProduto: null, quantidade: 7 },
    { pedidoOlistId: "1", sku: "CINCO", tituloProduto: "Bandeira", quantidade: 5 },
    { pedidoOlistId: "1", sku: "SKU2", tituloProduto: "Lenço", quantidade: 3 },
    { pedidoOlistId: "1", sku: "EMPATE-TITULO", tituloProduto: "Almofada", quantidade: 3 },
    { pedidoOlistId: "1", sku: "EMPATE-SEM-TITULO", tituloProduto: null, quantidade: 3 },
    { pedidoOlistId: "1", sku: "FORMULA", tituloProduto: "=1+1", quantidade: 1 },
    { pedidoOlistId: "2", sku: "AGREGADO", tituloProduto: "Zebra", quantidade: 4 },
  ];
  const originais = structuredClone(itens);
  let itensAtuais = itens;
  let consultasBusca = 0;
  let consultasTitulos = 0;
  const prismaAnterior = Reflect.get(globalThis, "prisma");
  const urlAnterior = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (prismaAnterior === undefined) Reflect.deleteProperty(globalThis, "prisma");
    else Reflect.set(globalThis, "prisma", prismaAnterior);
    if (urlAnterior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = urlAnterior;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  });
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => usuario, findUnique: async () => usuario },
    buscaSku: { findFirst: async (args: { where: unknown; select: { itens: { select: unknown } } }) => {
      consultasBusca++;
      assert.deepEqual(args.where, { id: buscaId, aplicativoId });
      assert.deepEqual(args.select.itens.select, { pedidoOlistId: true, sku: true, tituloProduto: true, quantidade: true });
      return { id: buscaId, situacoes: ["0"], quantidadePedidos: 2, quantidadeSkus: 9,
        createdAt: new Date("2026-11-18T18:39:46Z"), periodoInicio: null, periodoFim: null,
        pedidosForaPeriodo: 0, itens: itensAtuais };
    } },
    produtoOlist: { findMany: async () => { consultasTitulos++; return []; } },
    tipoProduto: { findMany: async () => { consultasTitulos++; return []; } },
  } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    data: { user: { id: usuario.id, email: "sku@example.test" } }, error: null,
  }));
  const { GET } = await import("../src/app/api/olist/anotar-sku/route");
  const requisicao = (formato = "") => new NextRequest(`https://example.test/api/olist/anotar-sku?id=${buscaId}&formato=${formato}`, {
    headers: { Authorization: "Bearer teste" },
  });
  const esperados = ["MAIOR", "SEM-TITULO", "AGREGADO", "CINCO", "EMPATE-TITULO", "SKU2", "SKU10", "EMPATE-SEM-TITULO", "FORMULA"];
  const quantidades = [10, 7, 6, 5, 3, 3, 3, 3, 1];

  await t.test("JSON soma pedidos antes de ordenar e desempata por título e SKU", async () => {
    const resposta = await GET(requisicao());
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get("Cache-Control"), "private, no-store");
    const { busca } = await resposta.json();
    assert.deepEqual(busca.skus.map((item: { sku: string }) => item.sku), esperados);
    assert.deepEqual(busca.skus.map((item: { quantidade: number }) => item.quantidade), quantidades);
    assert.deepEqual(busca.pedidos, ["1", "2"]);
    assert.deepEqual(itens, originais, "A ordenação não deve modificar os itens salvos");
  });

  for (const formato of ["csv", "xlsx", "pdf"]) {
    await t.test(`${formato} preserva a ordem do resultado`, async () => {
      const resposta = await GET(requisicao(formato));
      assert.equal(resposta.status, 200);
      const texto = Buffer.from(await resposta.arrayBuffer()).toString(formato === "pdf" ? "latin1" : "utf8");
      const padrao = formato === "csv" ? /^"([^"\r\n]+)",/gm
        : formato === "xlsx" ? /<c r="A\d+" t="inlineStr"><is><t>([^<]+)<\/t>/g
        : /BT \/F1 8 Tf 40 \d+ Td \(([^)]+)\) Tj ET/g;
      assert.deepEqual([...texto.matchAll(padrao)].map(linha => linha[1]), esperados);
      if (formato === "csv") assert.ok(texto.includes('"FORMULA","\'=1+1","1"'));
    });
  }

  await t.test("quantidade de consultas permanece constante nos quatro formatos", () => {
    assert.equal(consultasBusca, 4);
    assert.equal(consultasTitulos, 8, "Duas consultas de títulos por resposta, sem N+1");
  });

  await t.test("resultado vazio e resultado com um SKU mantêm o contrato", async () => {
    itensAtuais = [];
    assert.deepEqual((await (await GET(requisicao())).json()).busca.skus, []);
    itensAtuais = [itens[2]];
    assert.deepEqual((await (await GET(requisicao())).json()).busca.skus, [
      { sku: "MAIOR", tituloProduto: "Último no alfabeto", quantidade: 10 },
    ]);
  });

  await t.test("leitura continua exigindo sessão e permissão antes de buscar dados", async () => {
    const antes = consultasBusca;
    const semSessao = await GET(new NextRequest(`https://example.test/api/olist/anotar-sku?id=${buscaId}`));
    assert.equal(semSessao.status, 401);
    usuario.podeVisualizarAnotarSku = false;
    assert.equal((await GET(requisicao())).status, 403);
    assert.equal(consultasBusca, antes);
  });
});
