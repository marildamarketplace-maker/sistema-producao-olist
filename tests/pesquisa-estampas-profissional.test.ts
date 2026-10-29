import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test, { beforeEach } from "node:test";
import { Prisma } from "@prisma/client";
import { FILTROS_DESIGN_PESQUISA, normalizarDesignPesquisa } from "../src/domain/pesquisa-estampas-design";
import { filtrosDesignEstampasSql } from "../src/repositories/filtros-design-estampas-sql";
import { copiarFiltrosPesquisaEstampas, criarQueryPesquisaEstampas, FILTROS_VAZIOS_PESQUISA_ESTAMPAS, lerEstadoUrlPesquisaEstampas, temFiltroPesquisaEstampas } from "../src/services/filtrosPesquisaEstampas";

test("link restaura todos os critérios de design, paleta, ordenação e tamanho da página", () => {
  const filtros = { ...FILTROS_VAZIOS_PESQUISA_ESTAMPAS, consulta: "cereja", estilo: "romântico",
    distribuicao: "corrido", orientacao: "multidirecional", densidade: "densa", linguagemVisual: "aquarelado",
    aplicacaoSugerida: "vestuário", cores: ["azul claro", "creme"], modoCores: "QUALQUER" as const };
  const restaurado = lerEstadoUrlPesquisaEstampas(criarQueryPesquisaEstampas(filtros, 4, "CODIGO_ASC", 48));
  assert.deepEqual(restaurado, { filtros, pagina: 4, porPagina: 48, ordenacao: "CODIGO_ASC" });
  const copia = copiarFiltrosPesquisaEstampas(filtros);
  copia.cores.push("rosa");
  assert.equal(filtros.cores.length, 2);
});

test("links antigos mantêm 24 itens; parâmetros inválidos não geram NaN ou páginas ilimitadas", () => {
  const estado = lerEstadoUrlPesquisaEstampas(new URLSearchParams("q=cereja&estilo=ROMÂNTICO&cor=azul&cor=azul&pagina=Infinity&porPagina=999&modoCores=erro&distribuicao=erro"));
  assert.equal(estado.filtros.estilo, "romântico");
  assert.equal(estado.filtros.distribuicao, "");
  assert.equal(estado.filtros.modoCores, "TODAS");
  assert.deepEqual(estado.filtros.cores, ["azul"]);
  assert.equal(estado.pagina, 1);
  assert.equal(estado.porPagina, 24);
  assert.equal(estado.ordenacao, "RELEVANCIA");
  assert.equal(criarQueryPesquisaEstampas(estado.filtros, NaN, "RECENTES", Infinity).get("pagina"), "1");
});

test("cada novo critério permite pesquisa sozinho; modo de cores sozinho não consulta o catálogo", () => {
  for (const { campo, opcoes } of FILTROS_DESIGN_PESQUISA) assert.equal(temFiltroPesquisaEstampas({ [campo]: opcoes[0] }), true);
  assert.equal(temFiltroPesquisaEstampas({ modoCores: "QUALQUER" }), false);
});

test("metadados antigos, incompletos e estados não identificados não inventam características", () => {
  assert.deepEqual(normalizarDesignPesquisa(null), { distribuicoes: [], orientacoes: [], densidades: [], linguagensVisuais: [], aplicacoesSugeridas: [] });
  const design = normalizarDesignPesquisa({ composicaoVisual: {
    distribuicao: { estado: "AUSENTE", valores: ["corrido"] },
    densidade: { estado: "IDENTIFICADO", valores: ["densa", "densa", "inexistente"] },
  }, linguagemVisual: { estado: "IDENTIFICADO", valores: ["aquarelado"] }, aplicacoesSugeridas: {
    estado: "IDENTIFICADO", sugestoes: [
      { termo: "vestuário", confianca: 0.7, evidencias: ["motivo localizado"] },
      { termo: "decoração", confianca: 0.69 }, { termo: "acessórios", confianca: 2 },
      { termo: "moda praia", confianca: "0.9" }, { termo: "inventado", confianca: 0.9 },
    ],
  } });
  assert.deepEqual(design.distribuicoes, []);
  assert.deepEqual(design.densidades, ["densa"]);
  assert.deepEqual(design.linguagensVisuais, ["aquarelado"]);
  assert.deepEqual(design.aplicacoesSugeridas, [{ termo: "vestuário", confianca: 0.7, evidencias: ["motivo localizado"] }]);
});

test("filtros SQL exigem estado identificado e usam parâmetros, incluindo a confiança da aplicação", () => {
  const malicioso = "'); DROP TABLE estampas; --";
  const filtros = filtrosDesignEstampasSql({ estilo: malicioso, distribuicao: malicioso, aplicacaoSugerida: "vestuário" });
  for (const sql of filtros) assert.doesNotMatch(sql.sql, /DROP TABLE/);
  assert.equal(filtros[0].values[0], malicioso);
  assert.deepEqual(JSON.parse(filtros[1].values[0] as string), { response: { composicaoVisual: { distribuicao: { estado: "IDENTIFICADO", valores: [malicioso] } } } });
  assert.match(filtros[2].sql, /jsonb_typeof/);
  assert.match(filtros[2].sql, /IDENTIFICADO/);
  assert.ok(filtros[2].values.includes(0.7));
});

const consultas: Prisma.Sql[] = [];
let permitir = true;
let resultadoEstampas: Record<string, unknown>[] = [];
// Executa unstable_cache real com armazenamento isolado, sem servidor Next.
type EntradaCache = { value: { kind: string; data: { body: string }; revalidate: number }; gravadoEm: number };
const entradasCache = new Map<string, EntradaCache>();
let agoraCache = 0;
Object.assign(globalThis, { AsyncLocalStorage, __incrementalCache: {
  generateSimpleCacheKey: async (chave: string) => chave,
  get: async (chave: string) => {
    const entrada = entradasCache.get(chave);
    return entrada ? { value: entrada.value, isStale: agoraCache - entrada.gravadoEm >= entrada.value.revalidate * 1000 } : null;
  },
  set: async (chave: string, value: EntradaCache["value"]) => {
    entradasCache.set(chave, { value, gravadoEm: agoraCache });
  },
} });
beforeEach(() => {
  entradasCache.clear();
  agoraCache = 0;
  resultadoEstampas = [];
});
Object.assign(globalThis, { prisma: {
  usuario: {
    findFirst: async () => ({ id: "usuario-teste" }),
    findUnique: async () => ({ podeVisualizarEstampas: permitir, podeEditarEstampas: false }),
  },
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(0) }] : resultadoEstampas);
  },
  $transaction: () => { throw new Error("Pesquisa de leitura não deve abrir transação"); },
} });

test("serviço rejeita valores inválidos antes de consultar e exige critério explícito", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await assert.rejects(pesquisarEstampasCatalogo({}), /ao menos um filtro/);
  await assert.rejects(pesquisarEstampasCatalogo({ distribuicao: "sql malicioso" }), /Filtro de design inválido/);
  await assert.rejects(pesquisarEstampasCatalogo({ consulta: "cereja", modoCores: "erro" }), /Modo de cores inválido/);
  await assert.rejects(pesquisarEstampasCatalogo({ consulta: "cereja", cores: Array.from({ length: 11 }, (_, n) => String(n)) }), /máximo 10/);
  await assert.rejects(pesquisarEstampasCatalogo({ consulta: "cereja", porPagina: 61 }), /porPagina/);
  assert.equal(consultas.length, 0);
});

test("lista e contagem rodam sem transação e aplicam os mesmos filtros; concluídas são o padrão", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await pesquisarEstampasCatalogo({ distribuicao: "corrido", linguagemVisual: "aquarelado", cores: ["creme", "rosa"], modoCores: "QUALQUER", pagina: 2, porPagina: 48 });
  assert.equal(consultas.length, 2);
  for (const sql of consultas) {
    assert.match(sql.sql, /e.is_active = TRUE/);
    assert.match(sql.sql, /e.cores && ARRAY/);
    assert.ok(sql.values.includes("COMPLETED"));
    assert.ok(sql.values.includes(JSON.stringify({ response: { composicaoVisual: { distribuicao: { estado: "IDENTIFICADO", valores: ["corrido"] } } } })));
  }
  assert.deepEqual(consultas[0].values.slice(-2), [48, 48]);
  assert.deepEqual(consultas[0].values.slice(0, -2), consultas[1].values);
});

test("modo TODAS mantém inclusão de todas as cores; TODOS preserva consulta a outros status", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await pesquisarEstampasCatalogo({ cores: ["rosa", "creme"], status: "TODOS" });
  assert.match(consultas[0].sql, /e.cores @> ARRAY/);
  assert.doesNotMatch(consultas[0].sql, /e.processing_status =/);
});

test("facetas consideram o status solicitado e preservam os enums de apresentação", async () => {
  const { obterFacetasPesquisaEstampas } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await obterFacetasPesquisaEstampas();
  assert.ok(consultas[0].values.includes("COMPLETED"));
  assert.match(consultas[0].sql, /upper\(btrim\(valor\)\)/);
  assert.match(consultas[0].sql, /frequencia DESC/);
  assert.match(consultas[0].sql, /aplicacoesSugeridas/);
  assert.ok(consultas[0].values.includes(0.7));
  consultas.length = 0;
  await obterFacetasPesquisaEstampas("TODOS");
  assert.doesNotMatch(consultas[0].sql, /AND processing_status =/);
});

test("facetas reutilizam cache por status normalizado e revalidam após 300 segundos", async () => {
  const { obterFacetasPesquisaEstampas } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const inicial = await obterFacetasPesquisaEstampas();
  assert.deepEqual(await obterFacetasPesquisaEstampas(" completed "), inicial);
  assert.equal(consultas.length, 1);
  await obterFacetasPesquisaEstampas("PENDING");
  await obterFacetasPesquisaEstampas("TODOS");
  assert.equal(consultas.length, 3);
  assert.ok(consultas[1].values.includes("PENDING"));
  assert.doesNotMatch(consultas[2].sql, /AND processing_status =/);
  agoraCache = 299_000;
  await obterFacetasPesquisaEstampas();
  assert.equal(consultas.length, 3);
  agoraCache = 301_000;
  await obterFacetasPesquisaEstampas();
  assert.equal(consultas.length, 4);
  await assert.rejects(obterFacetasPesquisaEstampas("INVALIDO"), /Status de processamento inválido/);
  assert.equal(consultas.length, 4);
});

test("falha ao calcular facetas não armazena resultado inválido no cache", async (t) => {
  const { prisma } = await import("../src/lib/prisma");
  const { obterFacetasPesquisaEstampas } = await import("../src/services/pesquisarEstampasCatalogoService");
  const falha = t.mock.method(prisma, "$queryRaw", async () => { throw new Error("Falha de leitura"); });
  await assert.rejects(obterFacetasPesquisaEstampas(), /Falha de leitura/);
  assert.equal(entradasCache.size, 0);
  falha.mock.restore();
  consultas.length = 0;
  await obterFacetasPesquisaEstampas();
  assert.equal(consultas.length, 1);
});

test("API revalida permissão mesmo quando as facetas já estão em cache", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://teste.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-para-teste";
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  Object.assign(supabaseAdmin.auth, { getUser: async () => ({ data: { user: { id: "usuario-teste", email: "teste@example.com" } }, error: null }) });
  const { GET } = await import("../src/app/api/estampas/pesquisa/route");
  const { NextRequest } = await import("next/server");
  const url = "http://localhost/api/estampas/pesquisa?facetas=1";
  const headers = { Authorization: "Bearer token-ficticio" };
  consultas.length = 0;
  assert.equal((await GET(new NextRequest(url, { headers }))).status, 200);
  assert.equal((await GET(new NextRequest(url, { headers }))).status, 200);
  assert.equal(consultas.length, 1);
  permitir = false;
  try {
    const negada = await GET(new NextRequest(url, { headers }));
    assert.match((await negada.json()).error, /Sem permissão/);
    const semToken = await GET(new NextRequest(url));
    assert.match((await semToken.json()).error, /autenticação ausente/);
    assert.equal(consultas.length, 1);
  } finally {
    permitir = true;
  }
});

test("pesquisa cacheia o resultado serializado por 24h e valida antes de ler o cache", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  resultadoEstampas = [{ id: BigInt(1), createdAt: new Date(0), updatedAt: new Date(0), processedAt: new Date(0), processingStatus: "COMPLETED", relevancia: 0 }];
  const inicial = await pesquisarEstampasCatalogo({ categoria: "botânico" });
  const repetida = await pesquisarEstampasCatalogo({ categoria: "  botânico  ", pagina: 1, porPagina: 24, ordenacao: "RECENTES", status: "completed" });
  assert.deepEqual(repetida, inicial);
  assert.equal(repetida.estampas[0].id, "1");
  assert.equal(repetida.estampas[0].createdAt, new Date(0).toISOString());
  assert.equal(consultas.length, 2);
  agoraCache = 86_399_000;
  await pesquisarEstampasCatalogo({ categoria: "botânico" });
  assert.equal(consultas.length, 2);
  agoraCache = 86_401_000;
  await pesquisarEstampasCatalogo({ categoria: "botânico" });
  assert.equal(consultas.length, 4);
  await assert.rejects(pesquisarEstampasCatalogo({ categoria: "botânico", porPagina: 61 }), /porPagina/);
  assert.equal(consultas.length, 4);
});

test("pesquisa separa filtros, página, ordenação, status e preferências no cache", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const casos = [
    {}, { categoria: "geométrico" }, { pagina: 2 }, { porPagina: 12 },
    { ordenacao: "CODIGO_ASC" }, { status: "PENDING" },
    { preferencias: ["categoria"] }, { preferencias: ["categoria"], correspondenciaMinima: 100 },
    { cores: ["rosa"], modoCores: "QUALQUER" }, { cores: ["rosa"], modoCores: "TODAS" },
  ];
  for (const entrada of casos) await pesquisarEstampasCatalogo({ categoria: "botânico", ...entrada });
  assert.equal(consultas.length, casos.length * 2);
  for (const entrada of casos) await pesquisarEstampasCatalogo({ categoria: "botânico", ...entrada });
  assert.equal(consultas.length, casos.length * 2);
});

test("pesquisa não cacheia falha de leitura", async (t) => {
  const { prisma } = await import("../src/lib/prisma");
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  const falha = t.mock.method(prisma, "$queryRaw", async () => { throw new Error("Falha de leitura"); });
  await assert.rejects(pesquisarEstampasCatalogo({ categoria: "botânico" }), /Falha de leitura/);
  assert.equal(entradasCache.size, 0);
  falha.mock.restore();
  consultas.length = 0;
  await pesquisarEstampasCatalogo({ categoria: "botânico" });
  assert.equal(consultas.length, 2);
});

test("API verifica permissão com pesquisa já cacheada", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://teste.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-para-teste";
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  Object.assign(supabaseAdmin.auth, { getUser: async () => ({ data: { user: { id: "usuario-teste", email: "teste@example.com" } }, error: null }) });
  const { GET } = await import("../src/app/api/estampas/pesquisa/route");
  const { NextRequest } = await import("next/server");
  const url = "http://localhost/api/estampas/pesquisa?categoria=botânico";
  const headers = { Authorization: "Bearer token-ficticio" };
  consultas.length = 0;
  assert.equal((await GET(new NextRequest(url, { headers }))).status, 200);
  assert.equal((await GET(new NextRequest(url, { headers }))).status, 200);
  assert.equal(consultas.length, 2);
  permitir = false;
  try {
    const negada = await GET(new NextRequest(url, { headers }));
    assert.match((await negada.json()).error, /Sem permissão/);
    const semToken = await GET(new NextRequest(url));
    assert.match((await semToken.json()).error, /autenticação ausente/);
    assert.equal(consultas.length, 2);
  } finally { permitir = true; }
});

test("API bloqueia ausência de token e usuário sem permissão antes de pesquisar", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://teste.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-para-teste";
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  Object.assign(supabaseAdmin.auth, { getUser: async () => ({ data: { user: { id: "usuario-teste", email: "teste@example.com" } }, error: null }) });
  const { GET } = await import("../src/app/api/estampas/pesquisa/route");
  const { NextRequest } = await import("next/server");
  consultas.length = 0;
  const semToken = await GET(new NextRequest("http://localhost/api/estampas/pesquisa?distribuicao=corrido"));
  assert.equal(semToken.status, 400);
  assert.match((await semToken.json()).error, /autenticação ausente/);
  permitir = false;
  const semPermissao = await GET(new NextRequest("http://localhost/api/estampas/pesquisa?distribuicao=corrido", { headers: { Authorization: "Bearer token-ficticio" } }));
  assert.match((await semPermissao.json()).error, /Sem permissão/);
  assert.equal(consultas.length, 0);
  permitir = true;
});

test("API aceita os query params compartilhados e valida paginação, filtros e paleta", async () => {
  const { GET } = await import("../src/app/api/estampas/pesquisa/route");
  const { NextRequest } = await import("next/server");
  consultas.length = 0;
  const resposta = await GET(new NextRequest("http://localhost/api/estampas/pesquisa?estilo=romântico&distribuicao=barrado&cor=rosa&cor=creme&modoCores=QUALQUER&pagina=2&porPagina=12&ordenacao=CODIGO_ASC", { headers: { Authorization: "Bearer token-ficticio" } }));
  assert.equal(resposta.status, 200);
  const resultado = await resposta.json();
  assert.equal(resultado.pagina, 2);
  assert.equal(resultado.porPagina, 12);
  assert.match(consultas[0].sql, /e.cores && ARRAY/);
  assert.ok(consultas[0].values.includes("romântico"));
});

test("API restaura correspondência mínima do link e rejeita limites inválidos", async () => {
  const { GET } = await import("../src/app/api/estampas/pesquisa/route");
  const { NextRequest } = await import("next/server");
  consultas.length = 0;
  const headers = { Authorization: "Bearer token-ficticio" };
  const response = await GET(new NextRequest("http://localhost/api/estampas/pesquisa?q=cereja%20amarela&correspondenciaMinima=100&porPagina=48", { headers }));
  assert.equal(response.status, 200);
  const dados = await response.json();
  assert.deepEqual(dados.cobertura.termos, ["cereja", "amarela"]);
  assert.equal(dados.cobertura.minima, 100);
  assert.equal(dados.porPagina, 48);
  assert.match(consultas[0].sql, /aderencia.percentual >=/);
  assert.ok(consultas[0].values.includes(100));
  consultas.length = 0;
  const invalida = await GET(new NextRequest("http://localhost/api/estampas/pesquisa?q=cereja&correspondenciaMinima=101", { headers }));
  assert.equal(invalida.status, 400);
  assert.equal(consultas.length, 0);
});
