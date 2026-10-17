import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const matriz = id(2), filial = id(3), usuarioId = id(4), filaId = id(5), solicitacaoId = id(6), tecidoId = id(7), fornecedorId = id(8), planoId = id(9), previaId = id(10);
test("fila Olist: permissão, conta destinatária, prévia, confirmação e conciliação", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let integrado = true;
  let permitido = true, existe = true, filialValida = true, associado = true, cadastroAtivo = true, retornoMarcador = true;
  let fila: any, selecoesSalvas: unknown = null, previa: any = null, envio: any = null, registro: any = null;
  let posts = 0, consultas: string[] = [];
  let alterarDuranteConsulta = false;
  const dadosPedido = { versao: 1, observacao: "JSON revisado", itens: [{ produtoId: id(11), sku: "SKU-EST/6861-A/", tecido: { id: tecidoId, nome: "Tecido revisado", referencia: "ref-origem" }, quantidade: 4, unidade: "UN", quantidadeTecido: 7, unidadeTecido: "MT", estampa: "6861 editada", variante: "B", corteLaser: true, tamanho: "145x180", tipoProduto: "Toalha" }] };
  const selecoes = { clienteId: 100, vendedorId: 200, formaId: 300, planoId, tipoVenda: "VENDA", tecidos: [{ tecidoId, id: 400, preco: 10 }], laser: { id: 500, preco: 2 } };
  const reset = () => { fila = { id: filaId, fornecedorId, aplicativoFornecedorId: matriz, aplicativoFilialId: filial, solicitacaoProducaoId: solicitacaoId, dadosPedido: structuredClone(dadosPedido), versao: 0, status: "PENDENTE" }; previa = null; envio = null; registro = null; posts = 0; consultas = []; };
  reset();
  const tx: any = {
    $queryRaw: async () => [{ id: filial }],
    usuario: { findFirst: async () => ({ id: usuarioId, aplicativoId: matriz }), findUnique: async () => ({ aplicativoId: matriz, podeGerenciarFilaPedidos: permitido }) },
    aplicativo: {
      findFirst: async ({ where }: any) => { assert.equal(where.aplicativoPaiId, matriz); assert.equal(where.id, filial); return filialValida ? { id: filial, nome: "Filial A" } : null; },
      findUnique: async ({ where }: any) => { assert.equal(where.id, filial); return { id: filial, nome: "Filial A", olistClientId: integrado ? "fake" : "", olistClientSecret: integrado ? "fake" : "" }; },
    },
    integracaoOlistToken: { findUnique: async ({ where }: any) => { assert.equal(where.aplicativoId_provider.aplicativoId, filial); return { accessToken: "fake", expiresAt: new Date(Date.now() + 3600_000) }; } },
    pedidoFornecedorQueue: {
      findFirst: async ({ where }: any) => { assert.equal(where.aplicativoFornecedorId, matriz); return existe ? structuredClone(fila) : null; },
      updateMany: async ({ where, data }: any) => {
        if (where.versao !== undefined && where.versao !== fila.versao) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(fila.status)) return { count: 0 };
        if (data.status) fila.status = data.status; if (data.dadosPedido) fila.dadosPedido = structuredClone(data.dadosPedido); fila.versao++; return { count: 1 };
      },
      update: async ({ data }: any) => { fila.status = data.status; fila.versao++; return fila; },
    },
    configFornecedorFilial: {
      findUnique: async ({ where }: any) => { assert.deepEqual(where.fornecedorId_filialId, { fornecedorId, filialId: filial }); return selecoesSalvas ? { selecoes: selecoesSalvas } : null; },
      upsert: async ({ where, create }: any) => { assert.deepEqual(where.fornecedorId_filialId, { fornecedorId, filialId: filial }); selecoesSalvas = create.selecoes; },
    },
    formaPagamentoOlistPlano: {
      findFirst: async ({ where }: any) => { assert.equal(where.aplicativoId, filial); assert.equal(where.formaOlistId, "300"); return associado ? { planoPagamento: { nome: "30/60" } } : null; },
      findMany: async ({ where }: any) => { assert.equal(where.aplicativoId, filial); return [{ planoPagamento: { id: planoId, nome: "30/60" } }]; },
    },
    previaFornecedor: {
      create: async ({ data }: any) => { previa = { ...data, id: previaId }; return previa; },
      findFirst: async ({ where }: any) => previa && where.id === previa.id && where.usuarioId === previa.usuarioId && where.versao === previa.versao && previa.expiraEm > new Date() ? previa : null,
    },
    envioFornecedor: {
      findUnique: async () => envio,
      upsert: async ({ create }: any) => { envio = create; },
      update: async ({ data }: any) => { envio = { ...envio, ...data }; return envio; },
      updateMany: async ({ data }: any) => { envio = { ...envio, ...data }; return { count: 1 }; },
    },
    pedidoFornecedorSolicitacao: { findFirst: async () => registro, create: async ({ data }: any) => { registro = { ...data, id: id(12) }; return registro; } },
  };
  tx.$transaction = async (fn: any) => fn(tx);
  Object.assign(globalThis, { prisma: tx });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string) => {
    const u = new URL(url); consultas.push(u.pathname);
    if (alterarDuranteConsulta) { fila.versao++; alterarDuranteConsulta = false; }
    let data: any;
    if (u.pathname.endsWith("/vendedores")) data = { itens: [{ id: 200, nome: "Vendedor" }], paginacao: { total: 1 } };
    else if (u.pathname.endsWith("/pedidos/123")) data = { id: 123, observacoesInternas: retornoMarcador ? `Solicitacao fornecedor: ${solicitacaoId}` : "outro pedido" };
    else if (/\/(contatos|produtos|servicos|formas-pagamento)\/\d+$/.test(u.pathname)) data = { id: Number(u.pathname.split("/").pop()), nome: "Cadastro da filial", situacao: cadastroAtivo ? "A" : "I" };
    else data = { itens: [{ id: 100, nome: "Cadastro da filial", descricao: "Produto", preco: 10, situacao: "A" }], paginacao: { total: 1 } };
    return { status: 200, data, headers: { "content-type": "application/json" } };
  });
  t.mock.method(axios, "post", async () => { posts++; return { status: 200, data: { id: 123 } }; });
  const { GET, POST } = await import("../src/app/api/fornecedores/fila/[id]/olist/route");
  const ctx = { params: Promise.resolve({ id: filaId }) };
  const req = (body?: unknown, query = "") => new Request(`https://example.test/api?${query}`, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer fake" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const preview = (s: unknown = selecoes) => POST(req({ acao: "preview", versao: fila.versao, selecoes: s }), ctx);
  await t.test("nega sem sessão/permissão, outra matriz e filial inválida em leitura e escrita", async () => {
    assert.equal((await GET(new Request("https://example.test"), ctx)).status, 401);
    permitido = false; assert.equal((await GET(req(), ctx)).status, 403); assert.equal((await preview()).status, 403); permitido = true;
    existe = false; assert.equal((await GET(req(), ctx)).status, 404); assert.equal((await preview()).status, 404); existe = true;
    filialValida = false; assert.equal((await GET(req(), ctx)).status, 403); assert.equal((await preview()).status, 403); filialValida = true;
    assert.equal(posts, 0); assert.equal(consultas.length, 0);
  });
  await t.test("histórico de outros pedidos não preenche a seleção; JSON da filial atual preenche", async () => {
    selecoesSalvas = { selecoes };
    assert.equal((await (await GET(req(), ctx)).json()).selecoes, null);
    fila.dadosPedido.olist = { filialId: filial, selecoes: { clienteId: 100 } };
    assert.deepEqual((await (await GET(req(), ctx)).json()).selecoes, { clienteId: 100 });
    fila.dadosPedido.olist.filialId = id(99);
    assert.equal((await (await GET(req(), ctx)).json()).selecoes, null);
    delete fila.dadosPedido.olist; selecoesSalvas = null;
  });
  await t.test("consultas e planos usam exclusivamente filial salva; browser não escolhe outra conta", async () => {
    for (const recurso of ["clientes", "vendedores", "produtos", "servicos", "formas", "planos"]) {
      assert.equal((await GET(req(undefined, `recurso=${recurso}&formaId=300&aplicativoId=${id(99)}`), ctx)).status, 200);
    }
    assert.equal(posts, 0);
    assert.equal((await GET(req(undefined, "recurso=inexistente"), ctx)).status, 400);
  });
  await t.test("prévia preserva itens do JSON e salva seleções no próprio pedido e não cria externamente", async () => {
    const antes = structuredClone(fila.dadosPedido);
    const r = await preview(); assert.equal(r.status, 200); const d = await r.json();
    assert.equal(d.payload.itens[0].quantidade, 7); assert.equal(d.payload.itens[0].valorUnitario, 10);
    assert.match(d.payload.itens[0].infoAdicional, /6861 editada/); assert.match(d.payload.observacoes, /JSON revisado/);
    assert.deepEqual(d.payload.itens[1].produto, { id: 500, tipo: "S" }); assert.equal(d.payload.itens[1].quantidade, 7);
    const { olist, ...preservados } = fila.dadosPedido; assert.deepEqual(preservados, antes); assert.deepEqual(olist, { filialId: filial, selecoes }); assert.equal(posts, 0); assert.equal(selecoesSalvas, null);
    assert.ok(consultas.includes("/public-api/v3/servicos/500"));
    assert.equal((await GET(req(), ctx)).status, 200);
  });
  await t.test("bloqueia plano sem associação, cadastro inativo, laser ausente e produto de tecido indevido", async () => {
    integrado = false; const semIntegracao = await preview(); assert.equal(semIntegracao.status, 400); assert.match((await semIntegracao.json()).error, /OAuth/); integrado = true;
    associado = false; assert.equal((await preview()).status, 400); associado = true;
    cadastroAtivo = false; assert.equal((await preview()).status, 400); cadastroAtivo = true;
    assert.equal((await preview({ ...selecoes, laser: null })).status, 400);
    assert.equal((await preview({ ...selecoes, tecidos: [{ tecidoId: id(99), id: 400, preco: 10 }] })).status, 400);
    assert.equal((await preview({ ...selecoes, payload: {} })).status, 400); assert.equal(posts, 0);
  });
  await t.test("confirmação usa prévia do servidor, expiração/versão e associação revalidadas", async () => {
    await preview(); previa.expiraEm = new Date(0);
    const confirmar = () => POST(req({ acao: "confirmar", previaId }), ctx);
    assert.equal((await confirmar()).status, 409); await preview(); fila.versao++;
    assert.equal((await confirmar()).status, 409); await preview(); associado = false;
    assert.equal((await confirmar()).status, 400); associado = true;
    assert.equal((await confirmar()).status, 200); assert.equal(posts, 1); assert.equal(fila.status, "CONCLUIDO");
    assert.equal(registro.aplicativoDestinatarioId, filial); assert.equal(envio.estado, "CONCLUIDO");
    assert.equal((await confirmar()).status, 409); assert.equal(posts, 1);
  });
  await t.test("conciliação verifica Olist, impede ausência com ID conhecido e audita responsável", async () => {
    reset(); envio = { solicitacaoId, aplicativoId: filial, tentativaId: id(20), estado: "INCERTO", iniciadoEm: new Date(0), pedidoOlistId: "123", historico: [] };
    const justificar = { tentativaId: id(20), justificativa: "Conferência manual realizada" };
    assert.equal((await POST(req({ acao: "confirmar-ausencia", ...justificar, ausenciaConfirmada: true }), ctx)).status, 409);
    retornoMarcador = false; assert.equal((await POST(req({ acao: "vincular", ...justificar, pedidoOlistId: "123" }), ctx)).status, 400); retornoMarcador = true;
    assert.equal((await POST(req({ acao: "vincular", ...justificar, pedidoOlistId: "123" }), ctx)).status, 200);
    assert.equal(envio.estado, "CONCLUIDO"); assert.equal(envio.historico[0].usuarioId, usuarioId); assert.equal(posts, 0);
    reset(); envio = { solicitacaoId, aplicativoId: filial, tentativaId: id(20), estado: "RESERVADO", iniciadoEm: new Date(), historico: [] };
    assert.equal((await POST(req({ acao: "confirmar-ausencia", ...justificar, ausenciaConfirmada: true }), ctx)).status, 409);
    envio.iniciadoEm = new Date(0); assert.equal((await GET(req(), ctx)).status, 200); assert.equal(envio.estado, "INCERTO"); assert.equal(fila.status, "FALHADO");
    assert.equal((await POST(req({ acao: "confirmar-ausencia", ...justificar, ausenciaConfirmada: true }), ctx)).status, 200);
    assert.equal(envio.estado, "LIBERADO"); assert.equal(fila.status, "PENDENTE"); assert.equal(posts, 0);
  });
  await t.test("edição concorrente durante a validação não sobrescreve o JSON nem cria prévia", async () => {
    reset(); const antes = structuredClone(fila.dadosPedido); alterarDuranteConsulta = true;
    assert.equal((await preview()).status, 409); assert.deepEqual(fila.dadosPedido, antes);
    assert.equal(previa, null); assert.equal(posts, 0);
  });
  await t.test("CANCELADO não configura ou cria e payload da confirmação é estrito", async () => {
    reset(); fila.status = "CANCELADO"; assert.equal((await preview()).status, 409);
    assert.equal((await POST(req({ acao: "confirmar", previaId, payload: {} }), ctx)).status, 400); assert.equal(posts, 0);
  });
});
