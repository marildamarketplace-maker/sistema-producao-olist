import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const origem = id(1), matriz = id(2), filial = id(3), fornecedorId = id(4), solicitacaoId = id(5), tecidoId = id(6), usuarioId = id(7);

test("seleção Olist na revisão de origem: autorização, conta correta e snapshot parcial", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let permitido = true, podeFilial = true, fornecedorValido = true, solicitacaoValida = true, filialValida = true, ativo = true;
  let chamadas = 0, posts = 0, gravacoes = 0;
  const logs: unknown[] = [];
  t.mock.method(console, "info", (...args: unknown[]) => { logs.push(args); });
  let ultimo: Record<string, any> | null = null;
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, ...valores: unknown[]) => {
      if (sql.join("").includes("FROM aplicativo")) { assert.deepEqual(valores, [filial, matriz]); return filialValida ? [{ id: filial }] : []; }
      return [{ id: solicitacaoId }];
    },
    usuario: {
      findFirst: async () => ({ id: usuarioId, aplicativoId: origem }),
      findUnique: async () => ({ aplicativoId: origem, podeSolicitarProducao: permitido, podeSelecionarFilialFornecedor: podeFilial }),
    },
    solicitacaoProducao: { findFirst: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: solicitacaoId, aplicativoId: origem, status: "em_producao" }); return solicitacaoValida ? { id: solicitacaoId, observacaoGeral: "Original" } : null; } },
    fornecedor: { findFirst: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: fornecedorId, aplicativoId: origem }); return fornecedorValido ? { aplicativoPaiId: matriz, aplicativoPai: { aplicativoPaiId: null } } : null; } },
    aplicativo: {
      findFirst: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: filial, aplicativoPaiId: matriz }); return filialValida ? { id: filial, nome: "Filial" } : null; },
      findUnique: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: filial }); return { id: filial, nome: "Filial", olistClientId: "fake", olistClientSecret: "fake" }; },
    },
    integracaoOlistToken: { findUnique: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { aplicativoId_provider: { aplicativoId: filial, provider: "olist" } }); return { accessToken: "fake", expiresAt: new Date(Date.now() + 3600_000) }; } },
    formaPagamentoOlistPlano: {
      findMany: async ({ where }: { where: { aplicativoId: string } }) => { assert.equal(where.aplicativoId, filial); return [{ planoPagamento: { id: id(9), nome: "30/60" } }]; },
    },
    itemSolicitacaoProducao: { findMany: async () => [{ produtoId: id(10), sku: "SKU-EST/6861-A/", quantidadeSolicitada: 2, tipoCorte: "LASER" }] },
    produtoOlistProdutoFornecedor: { findMany: async () => [{ produtoId: id(10), quantidadeUsada: 1.5, produtoFornecedor: { id: tecidoId, nome: "Oxford", referencia: "REF" } }] },
    produtoFornecedor: { findMany: async () => [{ id: tecidoId, nome: "Oxford", referencia: "REF" }] },
    pedidoFornecedorQueue: { create: async ({ data }: { data: Record<string, unknown> }) => { gravacoes++; ultimo = data; return { id: id(11) }; } },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string) => {
    chamadas++; const u = new URL(url);
    const numero = Number(u.pathname.split("/").pop());
    return { status: 200, headers: { "content-type": "application/json" }, data: numero ? { id: numero, nome: "Cadastro", situacao: ativo ? "A" : "I" } : { itens: [{ id: 100, nome: "Cadastro", situacao: "A", preco: 10 }], paginacao: { total: 1 } } };
  });
  t.mock.method(axios, "post", async () => { posts++; throw new Error("Nenhum pedido deve ser criado na etapa de origem."); });
  const { GET } = await import("../src/app/api/fornecedores/fila/olist/route");
  const { POST } = await import("../src/app/api/fornecedores/fila/route");
  const req = (body?: unknown, extras = "") => new Request(`https://example.test/api?fornecedorId=${fornecedorId}&filialId=${filial}&solicitacaoId=${solicitacaoId}&${extras}`, { headers: { Authorization: "Bearer fake" }, method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
  const base = { fornecedorId, solicitacaoId, filialId: filial };
  const olist = { filialId: filial, selecoes: { clienteId: 100, tecidos: [{ tecidoId, id: 400, preco: 0 }] } };
  await t.test("exige sessão e as duas permissões antes de consultar conta externa", async () => {
    assert.equal((await GET(new Request(`https://example.test/?fornecedorId=${fornecedorId}&filialId=${filial}&solicitacaoId=${solicitacaoId}`))).status, 401);
    permitido = false; assert.equal((await GET(req())).status, 403); permitido = true;
    podeFilial = false; assert.equal((await GET(req())).status, 403); assert.equal((await POST(req({ ...base, olist }))).status, 403); podeFilial = true;
    assert.equal(chamadas, 0); assert.equal(gravacoes, 0);
  });
  await t.test("fornecedor/solicitação externos e filial de outro grupo não consultam Olist", async () => {
    fornecedorValido = false; assert.equal((await GET(req())).status, 404); fornecedorValido = true;
    solicitacaoValida = false; assert.equal((await GET(req())).status, 404); solicitacaoValida = true;
    filialValida = false; assert.equal((await GET(req())).status, 403); filialValida = true;
    assert.equal(chamadas, 0);
  });
  await t.test("pesquisas e planos usam a conta autorizada, ignorando conta arbitrária na URL", async () => {
    for (const recurso of ["clientes", "vendedores", "produtos", "servicos", "formas", "planos"]) {
      const r = await GET(req(undefined, `recurso=${recurso}&formaId=300&aplicativoId=${id(99)}`)); assert.equal(r.status, 200);
      assert.equal(r.headers.get("Cache-Control"), "no-store");
    }
    assert.equal(posts, 0); assert.equal(gravacoes, 0);
  });
  await t.test("não registra termos de pesquisa com dados de clientes", async () => {
    const r = await GET(req(undefined, "recurso=clientes&busca=NomePrivadoTeste"));
    assert.equal(r.status, 200); assert.doesNotMatch(JSON.stringify(logs), /NomePrivadoTeste/);
  });
  await t.test("salva seleção parcial e preço zero no JSON, mantendo PENDENTE e sem criar na Olist", async () => {
    const r = await POST(req({ ...base, olist })); assert.equal(r.status, 201);
    assert.deepEqual(ultimo?.dadosPedido.olist, olist); assert.equal(ultimo?.dadosPedido.itens[0].quantidadeTecido, 3);
    assert.equal(ultimo?.status, "PENDENTE"); assert.equal(ultimo?.aplicativoFilialId, filial); assert.equal(posts, 0);
  });
  await t.test("rejeita seleção de outra filial, tecido indevido, cadastro inativo e preço negativo", async () => {
    const antes = gravacoes;
    assert.equal((await POST(req({ ...base, olist: { ...olist, filialId: id(99) } }))).status, 400);
    assert.equal((await POST(req({ ...base, filialId: null, olist }))).status, 400);
    assert.equal((await POST(req({ ...base, olist: { ...olist, selecoes: { tecidos: [{ tecidoId: id(99), id: 400 }] } } }))).status, 400);
    ativo = false; assert.equal((await POST(req({ ...base, olist }))).status, 400); ativo = true;
    assert.equal((await POST(req({ ...base, olist: { ...olist, selecoes: { tecidos: [{ tecidoId, id: 400, preco: -1 }] } } }))).status, 400);
    assert.equal(gravacoes, antes); assert.equal(posts, 0);
  });
  await t.test("sem filial/dados comerciais continua permitindo enviar para revisão posterior", async () => {
    podeFilial = false; const antes = chamadas;
    assert.equal((await POST(req({ fornecedorId, solicitacaoId }))).status, 201);
    assert.equal(ultimo?.dadosPedido.olist, undefined); assert.equal(ultimo?.status, "PENDENTE"); assert.equal(chamadas, antes); assert.equal(posts, 0);
  });
});
