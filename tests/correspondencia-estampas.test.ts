import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calcularPercentualCorrespondencia, planejarConsultaEstampas } from "../src/domain/consulta-profissional-estampas";
import { correspondenciaEstampasSql } from "../src/repositories/correspondencia-estampas-sql";
import { criarQueryPesquisaEstampas, FILTROS_VAZIOS_PESQUISA_ESTAMPAS, lerEstadoUrlPesquisaEstampas, temFiltroPesquisaEstampas } from "../src/services/filtrosPesquisaEstampas";

test("cereja amarela representa dois critérios com cobertura de 100% ou 50%", () => {
  const plano = planejarConsultaEstampas("cereja amarela");
  assert.deepEqual(plano.positivos.map((item) => item.termo), ["cereja", "amarela"]);
  assert.match(plano.positivos[1].consulta, /"amarelo" OR "amarela"/);
  assert.equal(calcularPercentualCorrespondencia(2, 2), 100);
  assert.equal(calcularPercentualCorrespondencia(1, 2), 50);
  assert.equal(calcularPercentualCorrespondencia(2, 3), 66.7);
});

test("artigos, preposições e critérios repetidos não aumentam o denominador", () => {
  const plano = planejarConsultaEstampas("Cereja de cereja com AMARELA amarela");
  assert.equal(plano.positivos.length, 2);
  assert.equal(planejarConsultaEstampas("poá bolinhas").positivos.length, 1);
  assert.equal(planejarConsultaEstampas("amarelo amarela").positivos.length, 1);
});

test("expressões profissionais e frases entre aspas são critérios indivisíveis", () => {
  assert.deepEqual(planejarConsultaEstampas("animal print azul claro").positivos.map((item) => item.termo), ["animal print", "azul claro"]);
  const frase = planejarConsultaEstampas('"cereja amarela" aquarelado');
  assert.equal(frase.positivos.length, 2);
  assert.equal(frase.positivos[0].consulta, '"cereja amarela"');
  assert.equal(planejarConsultaEstampas('"animal print"').positivos[0].consulta, '"animal print"');
  assert.equal(planejarConsultaEstampas("sem direção dominante").positivos[0].termo, "sem direção dominante");
});

test("exclusões não contam como critérios percentuais e mantêm expressões compostas", () => {
  const plano = planejarConsultaEstampas("floral -animal print sem texto");
  assert.deepEqual(plano.positivos.map((item) => item.termo), ["floral"]);
  assert.deepEqual(plano.excluidos.map((item) => item.termo), ["animal print", "texto"]);
});

test("código com prefixo alfabético e variante preserva identidade exata", () => {
  for (const consulta of ["MV27849-B", "MV27849 B", "MV27849/B"]) {
    assert.deepEqual(planejarConsultaEstampas(consulta).positivos[0].codigo, { codigo: "MV27849", variante: "B" });
  }
  const sql = correspondenciaEstampasSql("MV27849-B");
  assert.match(sql.obrigatorios[0].sql, /lower\(e.codigo\) = lower/);
  assert.match(sql.obrigatorios[0].sql, /e.variante/);
  assert.doesNotMatch(sql.candidatos.sql, /search_vector/);
});

test("consulta vazia não apresenta porcentagem; entradas inválidas não são truncadas silenciosamente", () => {
  assert.equal(correspondenciaEstampasSql("").percentual.sql, "NULL::DOUBLE PRECISION");
  assert.throws(() => planejarConsultaEstampas("de com e"), /ao menos um termo/);
  assert.throws(() => planejarConsultaEstampas("-texto"), /ao menos um termo/);
  assert.throws(() => planejarConsultaEstampas('"cereja amarela'), /Feche as aspas/);
  assert.throws(() => planejarConsultaEstampas("cereja sem"), /após “sem”/);
  assert.throws(() => planejarConsultaEstampas("amarela -amarelo"), /incluído e excluído/);
  assert.throws(() => planejarConsultaEstampas("floral azul amarelo verde vermelho rosa bege preto branco roxo laranja marrom cinza"), /máximo 12/);
});

test("consulta candidata usa OR indexável e a cobertura não confunde ranking com porcentagem", () => {
  const sql = correspondenciaEstampasSql("cereja amarela -texto");
  assert.match(sql.candidatos.sql, /e.search_vector @@/);
  assert.match(sql.termos.sql, / \|\| /);
  assert.match(sql.percentual.sql, /CASE WHEN/);
  assert.match(sql.percentual.sql, /ROUND/);
  assert.equal(sql.percentual.values.at(-1), 2);
  assert.equal(sql.exclusoes.length, 1);
  assert.match(sql.exclusoes[0].sql, /NOT/);
  assert.ok(sql.encontrados.values.includes("cereja"));
  assert.ok(sql.ausentes.values.includes("amarela"));
});

test("texto pesquisado é sempre parametrizado, sem interpolação de SQL", () => {
  const sql = correspondenciaEstampasSql("cereja'); DROP TABLE estampas; --");
  assert.doesNotMatch(sql.candidatos.sql, /DROP TABLE/);
  assert.doesNotMatch(sql.percentual.sql, /DROP TABLE/);
});

test("mínimo de correspondência faz parte do link, mas sozinho não dispara pesquisa", () => {
  const filtros = { ...FILTROS_VAZIOS_PESQUISA_ESTAMPAS, consulta: "cereja amarela", correspondenciaMinima: 50 };
  assert.deepEqual(lerEstadoUrlPesquisaEstampas(criarQueryPesquisaEstampas(filtros, 2, "RELEVANCIA", 48)).filtros, filtros);
  assert.equal(lerEstadoUrlPesquisaEstampas(new URLSearchParams("q=cereja")).filtros.correspondenciaMinima, 1);
  assert.equal(lerEstadoUrlPesquisaEstampas(new URLSearchParams("correspondenciaMinima=101")).filtros.correspondenciaMinima, 1);
  assert.equal(temFiltroPesquisaEstampas(FILTROS_VAZIOS_PESQUISA_ESTAMPAS), false);
});

const consultas: Prisma.Sql[] = [];
Object.assign(globalThis, { prisma: {
  $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
    const sql = Prisma.sql(strings, ...valores);
    consultas.push(sql);
    return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(3), completas: BigInt(1), parciais: BigInt(2) }] : [
      { id: BigInt(1), codigo: "MV1", variante: "A", percentualCorrespondencia: 50, termosEncontrados: ["cereja"], termosAusentes: ["amarela"],
        atributosDesign: null, relevancia: 2, processingStatus: "COMPLETED", processedAt: null, createdAt: new Date(0) },
    ]);
  },
  $transaction: (operacoes: Promise<unknown>[]) => Promise.all(operacoes),
} });

test("serviço expõe termos, ausências e resumo global sem expor campos internos", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  const resultado = await pesquisarEstampasCatalogo({ consulta: "cereja amarela", correspondenciaMinima: 50, cores: ["verde"], pagina: 2 });
  assert.deepEqual(resultado.cobertura, { termos: ["cereja", "amarela"], excluidos: [], minima: 50, completas: 1, parciais: 2 });
  assert.deepEqual(resultado.estampas[0].correspondencia, { percentual: 50, termosEncontrados: ["cereja"], termosAusentes: ["amarela"] });
  assert.equal("percentualCorrespondencia" in resultado.estampas[0], false);
  for (const sql of consultas) {
    assert.match(sql.sql, /aderencia.percentual >=/);
    assert.match(sql.sql, /e.cores @> ARRAY/);
    assert.ok(sql.values.includes(50));
    assert.ok(sql.values.includes("COMPLETED"));
  }
  assert.match(consultas[0].sql, /ORDER BY aderencia.percentual DESC, relevancia DESC/);
  assert.match(consultas[1].sql, /FILTER \(WHERE aderencia.percentual = 100\)/);
});

test("API de serviço rejeita percentuais inválidos antes de ler o banco", async () => {
  const { pesquisarEstampasCatalogo } = await import("../src/services/pesquisarEstampasCatalogoService");
  consultas.length = 0;
  for (const minima of [0, 101, 50.5, NaN]) await assert.rejects(pesquisarEstampasCatalogo({ consulta: "cereja", correspondenciaMinima: minima }), /correspondenciaMinima/);
  assert.equal(consultas.length, 0);
});
