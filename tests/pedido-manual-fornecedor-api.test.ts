import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import type { Prisma } from "@prisma/client";
import { pedidoManualSchema, resolucaoPedidoManualSchema } from "../src/lib/pedido-manual-contrato";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("manual externo: fornecedor é referência e dono da fila, sem conceder gestão ao autor cliente", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const clienteId = id(2), matrizId = id(3), outroId = id(4), autorId = id(1), fornecedorId = id(5);
  const filialA=id(6),filialB=id(7),neto=id(8);
  const autor = { id: autorId, aplicativoId: clienteId, ativo: true, podeCriarOlistPedido: true,
    podeGerenciarFilaPedidos: true, vinculosOlistVersao: 1, podeSelecionarFilialFornecedor: false };
  let ativo = true, vinculado = true, revisao = 1, carteira = 20, consultas = 0, padraoIndisponivel = false;
  let comFiliais=false,vinculoMatriz=true;
  const regrasConsultadas:string[]=[];
  let alterarNoTx: (() => void) | null = null;
  const filas: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  const operadorId = id(50);
  let envio: Record<string, unknown> | null = null, posts = 0;
  const tx = {
    usuario: { findFirst: async () => autor, findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === operadorId ? { ...autor, id: operadorId, aplicativoId: matrizId, podeGerenciarFilaPedidos: true } : autor },
    fornecedor: {
      findMany: async () => ativo ? [{ id: fornecedorId, aplicativoPai: { id: matrizId, nome: "MV Tecidos" } }] : [],
      findFirst: async ({ where }: { where: { aplicativoId: string; aplicativoPaiId: string; ativo: boolean } }) =>
        ativo && where.aplicativoId === clienteId && where.aplicativoPaiId === matrizId && where.ativo ? { id: fornecedorId } : null,
    },
    aplicativo: {
      findFirst: async ({ where }: { where: { id?: string; aplicativoPaiId?: string; OR?: Array<{ id?: string }> } }) =>
        where.id === clienteId && where.OR?.some(a => a.id === clienteId) ? { id: clienteId, nome: "Meuryshop" } : null,
      findMany: async ({ where }: { where: { OR?: unknown; aplicativoPaiId?: string|{in:string[]} } }) => {
        if(where.OR)return [{id:clienteId,nome:"Meuryshop"}];
        const pais=typeof where.aplicativoPaiId==="string"?[where.aplicativoPaiId]:where.aplicativoPaiId?.in??[];
        return comFiliais&&pais.includes(matrizId)?[
          {id:filialA,nome:"MV A",aplicativoPaiId:matrizId},{id:filialB,nome:"MV B",aplicativoPaiId:matrizId},
        ]:[];
      },
      findUnique: async ({ where }: { where: { id: string } }) => [clienteId, matrizId, outroId,filialA,filialB,neto].includes(where.id)
        ? { id: where.id, nome: where.id === matrizId ? "MV Tecidos" : where.id===filialA?"MV A":where.id===filialB?"MV B":"Meuryshop",
          aplicativoPaiId:[filialA,filialB].includes(where.id)?matrizId:where.id===neto?filialA:null, olistClientId: "fake", olistClientSecret: "fake" } : null,
    },
    usuarioVendedorOlist: { findFirst: async ({ where }: { where: { usuarioId: string; aplicativoId?: string } }) =>
      ativo && vinculado && where.usuarioId === autorId && (where.aplicativoId === matrizId&&vinculoMatriz||comFiliais&&[filialA,filialB].includes(where.aplicativoId??""))
        ? { vendedorOlistId: where.aplicativoId===filialB?120:20, revisao, origemAplicativoId: clienteId, fornecedorMatrizId: matrizId }
        : !where.aplicativoId && padraoIndisponivel ? { vendedorOlistId: 99, revisao: 1, origemAplicativoId: null, fornecedorMatrizId: null } : null },
    integracaoOlistToken: { findUnique: async ({where}:{where:{aplicativoId_provider:{aplicativoId:string}}}) => ({ accessToken: where.aplicativoId_provider.aplicativoId, expiresAt: new Date(Date.now() + 3600_000) }) },
    direcionamentoPedidos:{findUnique:async({where}:{where:{aplicativoPaiId:string}})=>{
      regrasConsultadas.push(where.aplicativoPaiId);
      return comFiliais&&where.aplicativoPaiId===matrizId?{versao:7,aplicativoPadraoId:filialB,regras:[]}:null;
    }},
    pedidoFornecedorQueue: {
      findFirst: async ({ where }: { where: { id?: string; autorId: string; aplicativoSolicitanteId: string; chaveIdempotencia?: string } }) => filas.find(f =>
        f.autorId === where.autorId && f.aplicativoSolicitanteId === where.aplicativoSolicitanteId &&
        (where.id ? f.id === where.id : f.chaveIdempotencia === where.chaveIdempotencia)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const fila = { ...data, id: id(30 + filas.length), createdAt: new Date(), aplicativoFilial: { id: data.aplicativoFilialId, nome: "MV Tecidos" } };
        filas.push(fila); return fila;
      },
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    envioPedidoManual: {
      findUnique: async () => envio,
      upsert: async ({ create }: { create: Record<string, unknown> }) => { envio = { ...create }; return envio; },
      update: async ({ data }: { data: Record<string, unknown> }) => { if (envio) Object.assign(envio, data); return envio; },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { if (envio) Object.assign(envio, data); return { count: 1 }; },
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const texto = sql.join("?");
      if (texto.includes("fornecedor_relacao_bloquear")) { locks.push("relacao"); return []; }
      if (texto.includes("FROM usuario")) { locks.push("usuario"); return [{ id: autorId }]; }
      if (texto.includes("FROM direcionamento_pedidos")) return [{versao:7,aplicativoPadraoId:filialB}];
      if (texto.includes("FROM aplicativo")) return [{ id: values[0] }];
      return [];
    },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (db: typeof tx) => unknown,opcoes?:{isolationLevel?:string}) => {
    if (alterarNoTx&&!opcoes?.isolationLevel) { const mudar = alterarNoTx; alterarNoTx = null; mudar(); }
    return fn(tx);
  } } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: autorId, email: "manual@example.test" } }, error: null }));
  t.mock.method(axios, "get", async (url: string,config:{headers:{Authorization:string}}) => {
    consultas++;
    const u = new URL(url);
    const destinoB=comFiliais&&config.headers.Authorization===`Bearer ${filialB}`;
    const cliente = { id: destinoB?130:30, nome: "Cliente", cpfCnpj: "04252011000110", situacao: "A", vendedor: { id: destinoB&&carteira===20?120:carteira }, endereco: { uf: "MG" } };
    const vendedor = { id: destinoB?120:20, situacao: "A", contato: { id: 40, nome: "Vendedor", cpfCnpj: "52998224725", codigo: "V20" } };
    const data = u.pathname.endsWith("/vendedores") ? { itens: [vendedor], paginacao: { total: 1 } }
      : /\/contatos\/(30|130)$/.test(u.pathname) ? cliente : { itens: [cliente], paginacao: { total: 1 } };
    return { status: 200, data, headers: { "content-type": "application/json" } };
  });
  t.mock.method(axios, "post", async () => { throw new Error("Incluir na fila não chama Olist POST"); });
  const { GET, POST } = await import("../src/app/api/olist/pedidos/manuais/route");
  const req = (query = "", body?: unknown) => new Request(`https://example.test/manual?${query}`, {
    method: body ? "POST" : "GET", headers: { Authorization: "Bearer fake" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const resolver = (referenciaId=matrizId) => GET(req(`acao=resolver&aplicativoOrigemId=${referenciaId}&vendedorOrigemId=20&clienteOrigemId=30`));
  const montar = async (chave = id(20),referenciaId=matrizId) => {
    const response = await resolver(referenciaId); assert.equal(response.status, 200, await response.clone().text());
    const resolucao = resolucaoPedidoManualSchema.parse(await response.json());
    return pedidoManualSchema.parse({ versao: 2, origemManual: resolucao.referencia, decisaoDirecionamento: resolucao.decisao,
      fornecedorManual: resolucao.fornecedorManual, chaveIdempotencia: chave, aplicativoId: resolucao.decisao.aplicativoId, observacao: null,
      selecoes: { clienteId: resolucao.selecoes.clienteId, vendedorId: resolucao.selecoes.vendedorId }, itens: [{ id: id(21), tecidoNome: "Oxford", quantidade: 10,
        quantidadeTecido: 2, estampa: "A", variante: null, tamanho: "30x30", tipoProduto: "Lenço", corteLaser: false }] });
  };
  await t.test("opções incluem fornecedor ativo; padrão próprio e projeção mínima são preservados", async () => {
    const inicial = await (await GET(req())).json();
    assert.equal(inicial.aplicativoPadraoId, clienteId);
    assert.deepEqual(inicial.aplicativos, [{ id: clienteId, nome: "Meuryshop" }, { id: matrizId, nome: "MV Tecidos", fornecedorId }]);
    assert.equal(consultas, 0);
  });
  await t.test("referência própria sem vínculo não impede listar e selecionar fornecedor autorizado", async () => {
    const antes = consultas;
    padraoIndisponivel = true;
    try {
      const inicial = await GET(req()); assert.equal(inicial.status, 200);
      assert.equal((await inicial.json()).aplicativos.some((a: { id: string }) => a.id === matrizId), true);
      assert.equal((await GET(req(`aplicativoId=${clienteId}&recurso=clientes`))).status, 403);
      const externa = await GET(req(`aplicativoId=${matrizId}`)); assert.equal(externa.status, 200);
      assert.equal((await externa.json()).vendedorId, 20);
      assert.equal(consultas, antes, "listar opções e selecionar conta não consulta nem libera cadastros da referência própria");
    } finally { padraoIndisponivel = false; }
  });
  await t.test("sem vínculo ou sem relação não há fallback para consulta livre nem chamadas remotas", async () => {
    const antes = consultas;
    vinculado = false; assert.equal((await GET(req(`aplicativoId=${matrizId}&recurso=clientes`))).status, 403);
    assert.equal(consultas, antes);
    vinculado = true; ativo = false; assert.equal((await resolver()).status, 403); assert.equal(consultas, antes);
    ativo = true; assert.equal((await GET(req(`aplicativoId=${outroId}&recurso=clientes`))).status, 403);
  });
  await t.test("fila manual externa preserva autor/solicitante e regras do fornecedor", async () => {
    const body = await montar();
    assert.equal(body.decisaoDirecionamento.tipo, "CONTA_UNICA");
    assert.equal(body.fornecedorManual?.matrizId, matrizId);
    assert.equal(body.fornecedorManual?.destino.revisao, 1);
    locks.length = 0;
    const response = await POST(req("", body)); assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).filaExterna, true);
    const fila = filas[0];
    assert.equal(fila.aplicativoSolicitanteId, clienteId); assert.equal(fila.aplicativoFornecedorId, matrizId);
    assert.equal(fila.autorId, autorId); assert.equal(fila.fornecedorId, fornecedorId); assert.equal(fila.tipoOrigem, "MANUAL");
    assert.equal(fila.solicitacaoProducaoId, undefined); assert.equal(fila.aplicativoFilialId, matrizId);
    assert.equal(locks[0], "relacao"); assert.equal(locks[1], "usuario");
    ativo = false;
    const antes = consultas; assert.equal((await POST(req("", body))).status, 200); assert.equal(consultas, antes);
    assert.equal(filas.length, 1, "repetição recupera o aceite mesmo após encerramento");
    ativo = true;
  });
  await t.test("carteira, proveniência adulterada e mudança concorrente bloqueiam inclusão", async () => {
    const body = await montar(id(22)); const antes = filas.length;
    carteira = 99; assert.equal((await POST(req("", body))).status, 403); carteira = 20;
    assert.equal((await POST(req("", { ...body, fornecedorManual: undefined }))).status, 409);
    assert.equal((await POST(req("", { ...body, fornecedorManual: { ...body.fornecedorManual!, matrizId: outroId } }))).status, 409);
    alterarNoTx = () => { revisao++; };
    assert.equal((await POST(req("", body))).status, 409); assert.equal(filas.length, antes);
    const { validarFornecedorPedidoManual } = await import("../src/lib/pedido-manual-fornecedor");
    await assert.rejects(validarFornecedorPedidoManual(tx as unknown as Prisma.TransactionClient, body.fornecedorManual!), /Vínculo do vendedor alterado/);
  });
  await t.test("reserva externa usa autor cliente e bloqueia prévia antiga após revogação e reconfirmação", async st => {
    const { enviarPedidoManual } = await import("../src/lib/envio-pedido-manual");
    const { capturarFornecedorPedidoManual } = await import("../src/lib/pedido-manual-fornecedor");
    const { guardaReferenciaFilaManual } = await import("../src/lib/fila-manual-referencia");
    const body = await montar(id(23));
    const prova = body.fornecedorManual!;
    const contexto = { filaId: id(60), versao: 0, matrizId, aplicativoId: matrizId, usuarioId: operadorId,
      vendedorFixo: { autorId, vendedorId: 20 }, guardaReferencia: guardaReferenciaFilaManual(autor, body.origemManual, prova),
      payload: { vendedor: { id: 20 }, cliente: { id: 30 }, itens: [] } };
    st.mock.method(axios, "post", async () => { posts++; return { status: 200, data: { id: 123 }, headers: { "content-type": "application/json" } }; });
    ativo = false;
    await assert.rejects(enviarPedidoManual(contexto), /fornecedor|autorizados/); assert.equal(posts, 0);
    ativo = true; revisao++;
    await assert.rejects(enviarPedidoManual(contexto), /Vínculo do vendedor alterado/); assert.equal(posts, 0);
    const confirmada = await capturarFornecedorPedidoManual(autor, matrizId, matrizId);
    const resultado = await enviarPedidoManual({ ...contexto, guardaReferencia: guardaReferenciaFilaManual(autor, body.origemManual, confirmada) });
    assert.equal(resultado.status, "CONCLUIDO"); assert.equal(posts, 1);
    assert.equal(envio?.usuarioId, operadorId); assert.equal(envio?.estado, "CONCLUIDO");
  });
  await t.test("filiais do fornecedor viram referências sem vínculo na matriz; regra e fila continuam pertencendo à matriz",async()=>{
    const antigo=await montar(id(24));
    assert.equal((await POST(req("",antigo))).status,201);
    comFiliais=true;vinculoMatriz=false;
    try {
      const inicial=await (await GET(req())).json();
      assert.deepEqual(inicial.aplicativos,[{id:clienteId,nome:"Meuryshop"},{id:filialA,nome:"MV A",fornecedorId},{id:filialB,nome:"MV B",fornecedorId}]);
      assert.equal(inicial.aplicativoPadraoId,clienteId);
      for(const [app,vendedorId] of [[filialA,20],[filialB,120]] as const){
        const selecionada=await GET(req(`aplicativoId=${app}`));assert.equal(selecionada.status,200);
        assert.equal((await selecionada.json()).vendedorId,vendedorId);
      }
      const semConsulta=consultas;
      assert.equal((await GET(req(`aplicativoId=${matrizId}&recurso=clientes`))).status,403);
      assert.equal((await GET(req(`aplicativoId=${neto}&recurso=clientes`))).status,403);
      vinculado=false;
      assert.equal((await GET(req(`aplicativoId=${filialA}&recurso=clientes`))).status,403);
      assert.equal((await resolver(filialA)).status,403);
      assert.equal(consultas,semConsulta,"sem vínculo na referência não há consulta de cadastros");
      vinculado=true;
      regrasConsultadas.length=0;
      const body=await montar(id(25),filialA);
      assert.equal(body.decisaoDirecionamento.tipo,"PADRAO");assert.equal(body.decisaoDirecionamento.versao,7);
      assert.equal(body.aplicativoId,filialB);
      assert.deepEqual(body.selecoes,{clienteId:130,vendedorId:120});
      assert.equal(body.fornecedorManual?.matrizId,matrizId);
      assert.equal(body.fornecedorManual?.referencia.aplicativoId,filialA);
      assert.equal(body.fornecedorManual?.destino.aplicativoId,filialB);
      assert.ok(regrasConsultadas.length>0&&regrasConsultadas.every(app=>app===matrizId));
      const salva=await POST(req("",body));assert.equal(salva.status,201,await salva.clone().text());
      const fila=filas.at(-1)!;
      assert.equal(fila.aplicativoFornecedorId,matrizId);assert.equal(fila.aplicativoFilialId,filialB);
      assert.equal(fila.aplicativoSolicitanteId,clienteId);assert.equal(fila.autorId,autorId);assert.equal(fila.tipoOrigem,"MANUAL");
      assert.equal(fila.fornecedorId,fornecedorId);
      const antesReplay=consultas;
      assert.equal((await POST(req("",antigo))).status,200);
      assert.equal(consultas,antesReplay,"aceite histórico com referência matriz permanece recuperável");
      vinculoMatriz=true;
      const {validarReferenciaPersistidaPedidoManual}=await import("../src/lib/pedido-manual-correspondencia");
      assert.equal((await validarReferenciaPersistidaPedidoManual(autor,antigo.origemManual,matrizId,antigo.selecoes)).vendedorId,20,
        "referência persistida na matriz continua revalidada quando surgem filiais");
      assert.equal((await resolver()).status,403,"matriz omitida não pode virar nova referência por URL adulterada");
    }finally {comFiliais=false;vinculoMatriz=true;vinculado=true;}
  });
});
