import assert from "node:assert/strict";
import test from "node:test";
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
Object.assign(globalThis, { prisma: {
  usuario: {
    findFirst: async () => ({ id: "usuario-teste" }),
    findUnique: async () => ({ podeVisualizarEstampas: permitir, podeEditarEstampas: false }),
  },
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(0) }] : []);
  },
  $transaction: (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
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

test("lista e contagem aplicam os mesmos filtros profissionais; concluídas são o padrão", async () => {
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
