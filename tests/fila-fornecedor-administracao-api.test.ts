import assert from "node:assert/strict";
import test from "node:test";

const matriz = "00000000-0000-0000-0000-000000000002";
const filialA = "00000000-0000-0000-0000-000000000003";
const filialB = "00000000-0000-0000-0000-000000000004";
const externa = "00000000-0000-0000-0000-000000000099";
const pedidoId = "00000000-0000-0000-0000-000000000010";
const solicitacaoId = "00000000-0000-0000-0000-000000000011";
const usuarioId = "00000000-0000-0000-0000-000000000012";
const dadosPedido = {
  versao: 1, observacao: "Observação original",
  itens: [{ produtoId: "produto", sku: "EST/6861-A/", tecido: { id: "tecido", nome: "Oxford", referencia: null },
    quantidade: 2, unidade: "UN", quantidadeTecido: 3, unidadeTecido: "MT", estampa: "6861", variante: "A", corteLaser: true, tamanho: "", tipoProduto: "" }],
};

test("administração da fila isola pedidos recebidos e filiais, com autorização e controle de concorrência", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  let permitido = true;
  let existente = true;
  let falhar = false;
  let jsonValido = true;
  let versaoBanco = 0;
  let statusBanco = "PENDENTE";
  let consultas = 0;
  let gravacoes = 0;
  let filialBanco: string | null = null;
  const filtros: unknown[] = [];
  const tx = {
    pedidoFornecedorQueue: {
      findMany: async (args: { where: unknown; skip: number; take: number; select: unknown; orderBy: unknown }) => {
        if (falhar) throw new Error("senha-interna");
        consultas++;
        filtros.push(args.where);
        assert.equal(args.take, 20);
        assert.ok(args.skip >= 0);
        assert.deepEqual(args.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
        return [{ id: pedidoId, solicitacaoProducaoId: solicitacaoId, createdAt: new Date("2026-10-16T12:00:00Z"),
          direcionadoEm: null, status: statusBanco, versao: versaoBanco, dadosPedido: jsonValido ? dadosPedido : { itens: "invalido" },
          aplicativoSolicitante: { nome: "Meury Shop" }, aplicativoFilial: null }];
      },
      count: async ({ where }: { where: unknown }) => { filtros.push(where); return 21; },
      findFirst: async ({ where }: { where: unknown }) => {
        consultas++;
        assert.deepEqual(where, { id: pedidoId, aplicativoFornecedorId: matriz });
        return existente ? { id: pedidoId, status: statusBanco } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; aplicativoFornecedorId: string; versao: number; status: { in: string[] } }; data: Record<string, unknown> }) => {
        if (falhar) throw new Error("senha-interna");
        assert.equal(where.id, pedidoId);
        assert.equal(where.aplicativoFornecedorId, matriz);
        assert.equal(data.direcionadoPorId, usuarioId);
        assert.ok(data.direcionadoEm instanceof Date);
        assert.deepEqual(data.versao, { increment: 1 });
        assert.deepEqual(Object.keys(data).sort(), ["aplicativoFilialId", "direcionadoPorId", "direcionadoEm", "versao", "status"].sort());
        assert.deepEqual(where.status, { in: ["PENDENTE", "FALHADO"] });
        if (where.versao !== versaoBanco || !where.status.in.includes(statusBanco)) return { count: 0 };
        filialBanco = data.aplicativoFilialId as string;
        statusBanco = data.status as string;
        versaoBanco++;
        gravacoes++;
        return { count: 1 };
      },
    },
    aplicativo: { findMany: async ({ where, select }: { where: unknown; select: unknown }) => {
      assert.deepEqual(where, { aplicativoPaiId: matriz });
      assert.deepEqual(select, { id: true, nome: true });
      return [{ id: filialA, nome: "Filial A" }, { id: filialB, nome: "Filial B" }];
    } },
    $queryRaw: async (sql: TemplateStringsArray, filial: string, app: string) => {
      assert.match(sql.join("?"), /FOR SHARE/);
      assert.equal(app, matriz);
      return [filialA, filialB].includes(filial) ? [{ id: filial }] : [];
    },
  };
  Object.assign(globalThis, { prisma: {
    ...tx,
    usuario: { findFirst: async () => ({ id: usuarioId, aplicativoId: matriz }), findUnique: async () => ({ aplicativoId: matriz, podeGerenciarFilaPedidos: permitido, podeEditarConfiguracao: !permitido }) },
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Nenhuma chamada à Olist deve ocorrer nesta etapa."); });
  const { GET, PATCH } = await import("../src/app/api/fornecedores/fila/administracao/route");
  const get = (query = "") => GET(new Request(`https://example.test/api?${query}`, { headers: { Authorization: "Bearer teste" } }));
  const patch = (body: unknown = { pedidoId, filialId: filialA, versao: versaoBanco }) => PATCH(new Request("https://example.test/api", {
    method: "PATCH", headers: { Authorization: "Bearer teste" }, body: JSON.stringify(body),
  }));

  await t.test("exige sessão e permissão administrativa em leitura e escrita", async () => {
    const antes = consultas;
    assert.equal((await GET(new Request("https://example.test/api"))).status, 401);
    assert.equal((await PATCH(new Request("https://example.test/api", { method: "PATCH" }))).status, 401);
    permitido = false;
    assert.equal((await get()).status, 403);
    assert.equal((await patch()).status, 403);
    assert.equal(consultas, antes);
    permitido = true;
  });
  await t.test("lista snapshot dos pedidos recebidos, com paginação, sem expor credenciais", async () => {
    filtros.length = 0;
    const response = await get("pagina=2");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const json = await response.json();
    assert.equal(json.pagina, 2); assert.equal(json.total, 21); assert.equal(json.porPagina, 20);
    assert.deepEqual(filtros, [
      { aplicativoFornecedorId: matriz, status: "PENDENTE" }, { aplicativoFornecedorId: matriz, status: "PENDENTE" },
    ]);
    assert.equal(json.pedidos[0].origem, "Meury Shop");
    assert.deepEqual(json.pedidos[0].dadosPedido, dadosPedido);
    assert.equal(json.filiais.length, 2);
    assert.equal(json.pedidos[0].aplicativoSolicitante, undefined);
  });
  await t.test("filtra direcionados e todos sem aceitar aplicativo de outro tenant", async () => {
    filtros.length = 0;
    await get(`situacao=direcionado&aplicativoId=${externa}`);
    assert.deepEqual(filtros[0], { aplicativoFornecedorId: matriz, aplicativoFilialId: { not: null } });
    filtros.length = 0; await get("situacao=todos");
    assert.deepEqual(filtros[0], { aplicativoFornecedorId: matriz });
  });
  await t.test("JSON legado inválido não derruba toda a lista", async () => {
    jsonValido = false; const response = await get();
    assert.equal(response.status, 200); assert.equal((await response.json()).pedidos[0].dadosPedido, null);
    jsonValido = true;
  });
  await t.test("rejeita páginas e filtros inválidos", async () => {
    for (const query of ["pagina=0", "pagina=-1", "pagina=1.5", "pagina=abc", "pagina=100001", "situacao=nao-existe"]) {
      assert.equal((await get(query)).status, 400);
    }
  });
  await t.test("rejeita payload inválido e tentativa de injetar aplicativo ou JSON", async () => {
    const antes = consultas;
    for (const body of [null, {}, { pedidoId, filialId: "invalido", versao: 0 }, { pedidoId, filialId: filialA, versao: -1 },
      { pedidoId, filialId: filialA, versao: 0, aplicativoFornecedorId: externa }, { pedidoId, filialId: filialA, versao: 0, dadosPedido: {} }]) {
      assert.equal((await patch(body)).status, 400);
    }
    assert.equal(consultas, antes);
  });
  await t.test("não direciona pedido de outra matriz ou para filial de outro grupo, nem à própria matriz", async () => {
    existente = false; assert.equal((await patch()).status, 404); existente = true;
    assert.equal((await patch({ pedidoId, filialId: externa, versao: 0 })).status, 400);
    assert.equal((await patch({ pedidoId, filialId: matriz, versao: 0 })).status, 400);
    assert.equal(gravacoes, 0);
  });
  await t.test("direciona à filial A e permite trocar para B preservando o snapshot", async () => {
    const original = JSON.stringify(dadosPedido);
    assert.equal((await patch()).status, 200);
    assert.equal(filialBanco, filialA); assert.equal(versaoBanco, 1);
    const response = await patch({ pedidoId, filialId: filialB, versao: 1 });
    assert.equal(response.status, 200);
    assert.equal(filialBanco, filialB); assert.equal(versaoBanco, 2);
    assert.equal((await response.json()).versao, 2);
    assert.equal(JSON.stringify(dadosPedido), original);
  });
  await t.test("duas alterações concorrentes com a mesma versão não se sobrescrevem", async () => {
    const versao = versaoBanco;
    const antes = gravacoes;
    const responses = await Promise.all([patch({ pedidoId, filialId: filialA, versao }), patch({ pedidoId, filialId: filialB, versao })]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(gravacoes, antes + 1);
    assert.equal(versaoBanco, versao + 1);
  });
  await t.test("confirmação muda para PROCESSAR sem chamar Olist e bloqueia nova alteração", async () => {
    const response = await patch({ pedidoId, filialId: filialA, versao: versaoBanco, enviarOlist: true });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "PROCESSAR");
    assert.equal(statusBanco, "PROCESSAR");
    const antes = gravacoes;
    assert.equal((await patch()).status, 409);
    assert.equal(gravacoes, antes);
    for (const status of ["CONCLUIDO", "CANCELADO"]) {
      statusBanco = status;
      assert.equal((await patch()).status, 409);
    }
    statusBanco = "FALHADO";
    assert.equal((await patch({ pedidoId, filialId: filialB, versao: versaoBanco, enviarOlist: false })).status, 200);
    assert.equal(statusBanco, "PENDENTE");
  });
  await t.test("filtros usam os cinco status e cliente não pode forjar status final", async () => {
    for (const [filtro, status] of [["pendente", "PENDENTE"], ["processar", "PROCESSAR"], ["concluido", "CONCLUIDO"], ["falhado", "FALHADO"], ["cancelado", "CANCELADO"], ["processando", "PROCESSAR"], ["enviado", "CONCLUIDO"], ["com_falha", "FALHADO"]]) {
      filtros.length = 0;
      assert.equal((await get(`situacao=${filtro}`)).status, 200);
      assert.deepEqual(filtros[0], { aplicativoFornecedorId: matriz, status });
    }
    assert.equal((await patch({ pedidoId, filialId: filialA, versao: versaoBanco, status: "CONCLUIDO" })).status, 400);
    assert.equal((await patch({ pedidoId, filialId: filialA, versao: versaoBanco, enviarOlist: "true" })).status, 400);
  });
  await t.test("falhas internas não expõem detalhes sensíveis", async () => {
    falhar = true;
    for (const response of [await get(), await patch()]) {
      assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /senha-interna/);
    }
  });
});
