import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { validarPreferenciasPesquisa } from "../src/domain/preferencias-pesquisa-estampas";
import { copiarFiltrosPesquisaEstampas, criarQueryPesquisaEstampas, FILTROS_VAZIOS_PESQUISA_ESTAMPAS, lerEstadoUrlPesquisaEstampas, temFiltroPesquisaEstampas } from "../src/services/filtrosPesquisaEstampas";

test("código, variante, status e controles não podem virar preferências", () => {
  for (const campo of ["codigo", "variante", "status", "somenteAtivas", "ordenacao", "correspondenciaMinima"]) assert.throws(() => validarPreferenciasPesquisa([campo]), /inválidas/);
  assert.deepEqual(validarPreferenciasPesquisa(["estilo", "cores", "estilo"]), ["estilo", "cores"]);
});

test("link mantém escolhas, vazio explícito e compatibilidade com links anteriores", () => {
  for (const preferencias of [[], ["consulta"], ["estilo", "cores", "linguagemVisual"]]) {
    const filtros = { ...FILTROS_VAZIOS_PESQUISA_ESTAMPAS, estilo: "romântico", preferencias };
    assert.deepEqual(lerEstadoUrlPesquisaEstampas(criarQueryPesquisaEstampas(filtros, 2, "RELEVANCIA")).filtros, filtros);
    const copia = copiarFiltrosPesquisaEstampas(filtros);
    copia.preferencias.push("densidade");
    assert.notDeepEqual(copia.preferencias, filtros.preferencias);
  }
  assert.deepEqual(lerEstadoUrlPesquisaEstampas(new URLSearchParams("q=floral")).filtros.preferencias, ["consulta"]);
  assert.equal(lerEstadoUrlPesquisaEstampas(new URLSearchParams("estilo=romântico&preferencias=estilo")).ordenacao, "RELEVANCIA");
  assert.equal(temFiltroPesquisaEstampas(FILTROS_VAZIOS_PESQUISA_ESTAMPAS), false);
});

const consultas: Prisma.Sql[] = [];
Object.assign(globalThis, { prisma: {
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(0), completas: BigInt(0), parciais: BigInt(0) }] : []);
  },
  $transaction: (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
} });

test("preferências estruturadas entram no percentual sem pesquisa geral", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ estilo: "romântico", cores: ["amarelo"], linguagemVisual: "aquarelado", preferencias: ["cores", "linguagemVisual"] });
  assert.deepEqual(resultado.cobertura?.termos, ["Cores: amarelo", "Linguagem visual: aquarelado"]);
  assert.equal(resultado.ordenacao, "RELEVANCIA");
  assert.match(consultas[0].sql, /ORDER BY aderencia.percentual DESC/);
  assert.match(consultas[0].sql, /WHERE lower\(e.estilo\) = lower\(\?\) AND e.is_active = TRUE/);
  for (const sql of consultas) {
    assert.ok(sql.values.includes("COMPLETED"));
    assert.match(sql.sql, /aderencia.percentual >=/);
  }
});

test("pesquisa geral pode ser obrigatória; só preferências selecionadas pontuam", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "cereja amarela -texto", estilo: "romântico", preferencias: ["estilo"] });
  assert.deepEqual(resultado.cobertura?.termos, ["Estilo: romântico"]);
  assert.deepEqual(resultado.cobertura?.excluidos, ["texto"]);
  assert.match(consultas[0].sql, /AND NOT/);
  assert.ok(consultas[0].values.includes('"cereja"'));
  assert.ok(consultas[0].values.includes('"amarelo" OR "amarela" OR "amarelos" OR "amarelas"'));
});

test("sem preferências ativas o resultado não inventa percentual", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "cereja amarela", preferencias: [] });
  assert.equal(resultado.cobertura, null);
  assert.doesNotMatch(consultas[0].sql, /aderencia.percentual >=/);
  const codigo = await pesquisarEstampasCatalogo({ consulta: "MV27849-B", preferencias: ["consulta"] });
  assert.equal(codigo.cobertura, null);
});

test("código digitado no texto e exclusões são obrigatórios mesmo com preferências", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "MV27849-B floral -texto", estilo: "romântico", preferencias: ["consulta", "estilo"] });
  assert.deepEqual(resultado.cobertura?.termos, ["floral", "Estilo: romântico"]);
  for (const sql of consultas) {
    assert.match(sql.sql, /lower\(e.codigo\) = lower/);
    assert.match(sql.sql, /e.variante/);
    assert.match(sql.sql, /AND NOT/);
    assert.ok(sql.values.includes("MV27849"));
  }
});

test("serviço rejeita tentativas de relaxar status antes de consultar o banco", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  await assert.rejects(pesquisarEstampasCatalogo({ consulta: "floral", preferencias: ["status"] }), /inválidas/);
  assert.equal(consultas.length, 0);
});

test("cada filtro de conteúdo tem um predicado de preferência e mantém status obrigatório", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  const exemplos = {
    tema: "floral", cores: ["amarelo"], palavraChave: "flor", elementoVisual: "flor", categoria: "botânico",
    ocasiao: "casamento", publicoSugerido: "adulto", contextoUso: "decoração", afinidadeVisual: "romântico",
    padraoTextil: "floral", estilo: "romântico", distribuicao: "corrido", orientacao: "vertical", densidade: "densa",
    linguagemVisual: "aquarelado", aplicacaoSugerida: "vestuário", tipoImagem: "ESTAMPA", suporteAplicacao: "MODELO_REAL", conteudoImagem: "ESTAMPA",
  };
  for (const [campo, valor] of Object.entries(exemplos)) {
    consultas.length = 0;
    const resultado = await pesquisarEstampasCatalogo({ [campo]: valor, preferencias: [campo] });
    assert.equal(resultado.cobertura?.termos.length, 1, campo);
    assert.match(consultas[0].sql, /aderencia.percentual >=/, campo);
    assert.match(consultas[0].sql, /e.processing_status =/, campo);
    assert.ok(consultas[0].values.includes("COMPLETED"), campo);
  }
});
