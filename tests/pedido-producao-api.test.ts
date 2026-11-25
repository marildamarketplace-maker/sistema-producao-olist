import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { Prisma } from "@prisma/client";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("API de produção isola origem, preserva snapshot editado e reconcilia tentativas", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  process.env.OLIST_OAUTH_STATE_SECRET = "test-pedido-producao-secret-32-characters";
  const usuario = { id: id(1), aplicativoId: id(2), ativo: true, podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true, vinculosOlistVersao: 1 };
  let origemExiste = true, statusOrigem = "em_producao", quantidade = 2, permitidoTx = true, consultas = 0;
  let envioAnterior: { estado: string; pedidoOlistId: string | null } | null = null;
  let regraVersao = 1;
  let regraDestino = id(3), lockOrigem = false, variasFiliais = false, revogarFilialTx = false;
  type Registro = { id: string; status: string; createdAt: Date; autorId: string; chaveIdempotencia: string; hashEntrada: string;
    solicitacaoProducaoId: string; aplicativoSolicitanteId: string; aplicativoFilial: { id: string; nome: string }; dadosPedido: unknown; tipoOrigem: string };
  const registros: Registro[] = [];
  const tx = {
    usuario: { findFirst: async () => usuario, findUnique: async () => ({ ...usuario, podeSolicitarProducao: permitidoTx && usuario.podeSolicitarProducao }) },
    aplicativo: {
      findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [{ id: id(2), nome: "Origem" }] : [{ id: id(3), nome: "Filial", aplicativoPaiId: id(4) }, ...(variasFiliais ? [{ id: id(12), nome: "Outra filial", aplicativoPaiId: id(4) }] : [])],
      findFirst: async () => null,
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, nome: "Filial", aplicativoPaiId: where.id === id(2) ? null : id(4), olistClientId: "fake", olistClientSecret: "fake" }),
    },
    fornecedor: {
      findMany: async () => [{ id: id(5), aplicativoPai: { id: id(4), nome: "Fornecedor" } }],
      findFirst: async () => ({ id: id(5) }),
    },
    usuarioVendedorOlist: { findMany: async () => [{ aplicativoId:id(3), vendedorOlistId:20, fornecedorMatrizId:id(4), aplicativo:{id:id(3),aplicativoPaiId:id(4)} }, ...(variasFiliais ? [{ aplicativoId:id(12), vendedorOlistId:20, fornecedorMatrizId:id(4), aplicativo:{id:id(12),aplicativoPaiId:id(4)} }] : [])], findFirst: async () => ({ vendedorOlistId: 20, revisao: 1, origemAplicativoId: id(2), fornecedorMatrizId: id(4) }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "fake", expiresAt: new Date(Date.now() + 3600000) }) },
    direcionamentoPedidos: { findUnique: async () => ({ versao: regraVersao, aplicativoPadraoId: regraDestino, regras: [] }) },
    solicitacaoProducao: { findFirst: async ({ where }: { where: { aplicativoId: string; status?: string } }) => {
      assert.equal(where.aplicativoId, id(2));
      return origemExiste && (!where.status || where.status === statusOrigem) ? { id: id(6), status: statusOrigem, observacaoGeral: "Origem" } : null;
    } },
    itemSolicitacaoProducao: { findMany: async ({ select, take }: { select: Record<string, boolean>; take: number }) => {
      assert.equal(take, 1001); assert.equal(select.imagemUrl, undefined);
      return [{ id: id(7), produtoId: id(8), sku: "EST/6861-A/", quantidadeSolicitada: quantidade, tipoCorte: "LASER" },
        { id: id(9), produtoId: id(10), sku: "REMOVIDO", quantidadeSolicitada: 1, tipoCorte: null }];
    } },
    produtoOlistProdutoFornecedor: { findMany: async () => [{ produtoId: id(8), quantidadeUsada: 1.5, produtoFornecedor: { id: id(11), nome: "Oxford", referencia: null } }] },
    pedidoFornecedorSolicitacao: { findFirst: async () => { assert.equal(lockOrigem, true); return null; } },
    envioFornecedor: { findUnique: async () => { assert.equal(lockOrigem, true); return envioAnterior; } },
    pedidoFornecedorQueue: {
      findFirst: async ({ where }: { where: { id?: string; solicitacaoProducaoId?: string; aplicativoSolicitanteId?: string; autorId?: string } }) => registros.find(r =>
        (!where.id || r.id === where.id) && (!where.solicitacaoProducaoId || r.solicitacaoProducaoId === where.solicitacaoProducaoId) &&
        (!where.autorId || r.autorId === where.autorId) && (!where.aplicativoSolicitanteId || r.aplicativoSolicitanteId === where.aplicativoSolicitanteId)) ?? null,
      create: async ({ data }: { data: Omit<Registro, "id" | "createdAt" | "aplicativoFilial"> & { aplicativoFilialId: string } }) => {
        if (registros.length) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" });
        const registro = { ...data, id: id(90), createdAt: new Date(), aplicativoFilial: { id: data.aplicativoFilialId, nome: "Filial" } };
        registros.push(registro); return registro;
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("solicitacoes_producao")) lockOrigem = true;
      if (sql.includes("direcionamento_pedidos")) return [{ versao: 1, aplicativoPadraoId: regraDestino }];
      if (sql.includes("FROM aplicativo")) return [{ id: valores[0] }];
      return [{ id: usuario.id }];
    },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(revogarFilialTx ? { ...tx, usuario: { ...tx.usuario, findUnique: async () => ({ ...usuario, podeSelecionarFilialFornecedor: false }) } } : tx) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuario.id, email: "test@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string) => {
    consultas++; const u = new URL(url);
    const data = u.pathname.endsWith("/vendedores") ? { itens: [{ id: 20, contato: { nome: "Vendedor", cpfCnpj: null }, situacao: "A" }], paginacao: { total: 1 } }
      : u.pathname.endsWith("/contatos/30") ? { id: 30, nome: "Cliente", cpfCnpj: "04252011000110", situacao: "A", vendedor: { id: 20 }, endereco: { uf: null } }
      : { itens: [{ id: 30, nome: "Cliente", situacao: "A" }], paginacao: { total: 1 } };
    return { status: 200, data, headers: { "content-type": "application/json" } };
  });
  t.mock.method(axios, "post", async () => { throw new Error("Teste não deve criar pedido Olist"); });
  const { GET, POST } = await import("../src/app/api/olist/pedidos/producao/route");
  const req = (query = "", body?: unknown, solicitacao = id(6)) => new Request(`https://example.test/api?solicitacaoId=${solicitacao}&${query}`, {
    method: body ? "POST" : "GET", headers: { Authorization: "Bearer fake" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await t.test("contexto de produção é obrigatório e não autoriza recursos de outro aplicativo", async () => {
    assert.equal((await GET(new Request("https://example.test"))).status, 401);
    assert.equal((await GET(req("", undefined, "invalido"))).status, 400);
    usuario.podeSolicitarProducao = false; assert.equal((await GET(req())).status, 403); usuario.podeSolicitarProducao = true;
    origemExiste = false; assert.equal((await GET(req())).status, 404); origemExiste = true;
    usuario.podeSelecionarFilialFornecedor = false; assert.equal((await GET(req(`aplicativoId=${id(3)}`))).status, 200); usuario.podeSelecionarFilialFornecedor = true;
    assert.deepEqual((await (await GET(req())).json()).aplicativos, [{ id: id(3), nome: "Filial", fornecedorId: id(5), vendedorId:20, bloqueio:null }]);
    assert.equal((await GET(req(`aplicativoId=${id(2)}`))).status, 403);
  });
  await t.test("sem permissão de filial usa referência canônica e apenas destino derivado no servidor", async () => {
    usuario.podeSelecionarFilialFornecedor = false; variasFiliais = true;
    const lista = await (await GET(req())).json(); assert.equal(lista.aplicativos.length, 1);
    assert.equal((await GET(req(`aplicativoId=${id(12)}`))).status, 403);
    const params = `aplicativoOrigemId=${id(3)}&vendedorOrigemId=20&clienteOrigemId=30`;
    regraDestino = id(12);
    assert.equal((await GET(req(`acao=resolver&${params}`))).status, 200);
    assert.equal((await GET(req(`aplicativoId=${id(12)}&${params}`))).status, 200);
    const resolvida = await (await GET(req(`acao=resolver&${params}`))).json();
    const queryAssinada = `aplicativoId=${id(12)}&${params}&contextoConsulta=${encodeURIComponent(resolvida.contextoConsulta)}`;
    const antes = consultas;
    assert.equal((await GET(req(`${queryAssinada}&recurso=produtos`))).status, 200);
    assert.equal(consultas - antes, 1, "Pesquisa assinada não repete as sete consultas de identidade");
    const antesMetadados = consultas;
    assert.equal((await GET(req(queryAssinada))).status, 200);
    assert.equal(consultas, antesMetadados);
    const usuarioOriginal = usuario.id;
    usuario.id = id(77);
    assert.equal((await GET(req(queryAssinada))).status, 409);
    usuario.id = usuarioOriginal;
    assert.equal((await GET(req(queryAssinada, undefined, id(78)))).status, 409);
    const { assinarConsultaProducao, lerConsultaProducao } = await import("../src/lib/pedido-producao-contexto");
    const contexto = lerConsultaProducao(resolvida.contextoConsulta);
    const semPrazo = { ...contexto };
    const expirado = assinarConsultaProducao(semPrazo, Date.now()-120_001);
    assert.equal((await GET(req(queryAssinada.replace(encodeURIComponent(resolvida.contextoConsulta), encodeURIComponent(expirado))))).status, 409);

    assert.equal((await GET(req(queryAssinada.replace("clienteOrigemId=30", "clienteOrigemId=31")))).status, 409);
    assert.equal((await GET(req(queryAssinada.replace("vendedorOrigemId=20", "vendedorOrigemId=21")))).status, 409);
    assert.equal((await GET(req(queryAssinada.replace(`aplicativoId=${id(12)}`, `aplicativoId=${id(3)}`)))).status, 409);
    regraVersao++;
    assert.equal((await GET(req(queryAssinada))).status, 409);
    regraVersao--;
    usuario.vinculosOlistVersao++;
    assert.equal((await GET(req(queryAssinada))).status, 409);
    usuario.vinculosOlistVersao--;
    usuario.podeSelecionarFilialFornecedor = true;
    assert.equal((await GET(req(queryAssinada))).status, 409);
    usuario.podeSelecionarFilialFornecedor = false;

    assert.equal((await GET(req(`aplicativoId=${id(12)}&acao=origem&${params}`))).status, 403);
    regraDestino = id(3);
    assert.equal((await GET(req(`aplicativoId=${id(12)}&${params}`))).status, 403);
    variasFiliais = false; usuario.podeSelecionarFilialFornecedor = true;
  });
  const origem = await (await GET(req(`acao=origem&aplicativoId=${id(3)}`))).json();
  const resolveQuery = `acao=resolver&aplicativoOrigemId=${id(3)}&vendedorOrigemId=20&clienteOrigemId=30`;
  const resolucaoResponse = await GET(req(resolveQuery));
  assert.equal(resolucaoResponse.status, 200, await resolucaoResponse.clone().text());
  const resolucao = await resolucaoResponse.json();
  const entrada = { versao: 2, origemManual: resolucao.referencia, decisaoDirecionamento: resolucao.decisao, fornecedorManual: resolucao.fornecedorManual,
    chaveIdempotencia: id(80), aplicativoId: id(3), revisaoProducao: origem.revisao, observacao: "Editada",
    selecoes: { clienteId: 30, vendedorId: 20, formaId: 40, planoId: id(70), laser: { id: 50, preco: 2 } },
    itens: [{ ...origem.itens[0], quantidade: 9 }, { ...origem.itens[0], id: id(81), tecidoNome: "Novo", corteLaser: false }] };
  await t.test("novo pedido de produção também exige plano e serviço laser", async () => {
    for (const selecoes of [{ ...entrada.selecoes, planoId: undefined }, { ...entrada.selecoes, laser: undefined }]) {
      const resposta = await POST(req("", { ...entrada, selecoes }));
      assert.equal(resposta.status, 400); const erro = await resposta.json();
      assert.ok(erro.campos.planoId || erro.campos.laser);
    }
  });
  await t.test("bloqueia origem/regra alterada, revogação durante transação e envio incerto", async () => {
    quantidade = 3; assert.equal((await POST(req("", entrada))).status, 409); quantidade = 2;
    revogarFilialTx = true; assert.equal((await POST(req("", entrada))).status, 409); revogarFilialTx = false;
    permitidoTx = false; assert.equal((await POST(req("", entrada))).status, 403); permitidoTx = true;
    envioAnterior = { estado: "INCERTO", pedidoOlistId: null }; assert.equal((await POST(req("", entrada))).status, 409); envioAnterior = null;
    regraDestino = id(99); assert.equal((await POST(req("", entrada))).status, 409); regraDestino = id(3);
    assert.equal(registros.length, 0);
  });
  await t.test("grava apenas snapshot final na fila vinculada e mantém dados da solicitação", async () => {
    usuario.podeSelecionarFilialFornecedor = false;
    const respostas = await Promise.all([POST(req("", entrada)), POST(req("", entrada))]);
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 201]);
    assert.equal((await respostas[0].json()).id, (await respostas[1].json()).id);
    const registro = registros[0]; assert.equal(registro.tipoOrigem, "PRODUCAO"); assert.equal(registro.solicitacaoProducaoId, id(6));
    const snapshot = registro.dadosPedido as { itens: Array<{ sku: string; quantidade: number; unidade: string; quantidadeTecido: number }>; observacao: string; vendedorOrigem: { tipo: string } };
    assert.deepEqual(snapshot.itens.map(i => i.sku), ["EST/6861-A/", ""]); assert.equal(snapshot.itens[0].quantidade, 9);
    assert.equal(snapshot.itens[0].quantidadeTecido, 3); assert.equal(snapshot.observacao, "Editada"); assert.equal(snapshot.vendedorOrigem.tipo, "VINCULO");
    assert.equal(quantidade, 2); assert.equal(registros.length, 1);
  });
  await t.test("reconcilia retry sem consultas externas, rejeita outro conteúdo e preserva comprovante após produção", async () => {
    const antes = consultas;
    assert.equal((await POST(req("", entrada))).status, 200); assert.equal(consultas, antes);
    const conflito = await POST(req("", { ...entrada, observacao: "Outro" })); assert.equal(conflito.status, 409);
    assert.equal((await conflito.json()).pedidoExistente.id, id(90)); assert.equal(registros.length, 1);
    statusOrigem = "concluido";
    assert.equal((await GET(req(`pedidoId=${id(90)}`))).status, 200);
    assert.equal((await POST(req("", entrada))).status, 200);
    usuario.id = id(100); assert.equal((await GET(req(`pedidoId=${id(90)}`))).status, 404);
    const outroAutor = await POST(req("", entrada)); assert.equal(outroAutor.status, 409); assert.doesNotMatch(await outroAutor.text(), /hashEntrada|chaveIdempotencia/);
  });
});
