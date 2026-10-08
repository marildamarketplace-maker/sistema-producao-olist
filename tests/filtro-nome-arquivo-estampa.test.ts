import assert from "node:assert/strict";
import test from "node:test";
import {
  nomeArquivoEstampaDeveSerIgnorado,
  normalizarTermosIgnoradosNomeArquivo,
  TERMOS_IGNORADOS_NOME_ARQUIVO_ESTAMPA,
} from "../src/domain/filtro-nome-arquivo-estampa";
import { filtroNomeArquivoEstampaSql } from "../src/repositories/filtro-nome-arquivo-estampa-sql";

const termos = TERMOS_IGNORADOS_NOME_ARQUIVO_ESTAMPA;

test("ignora nomes sem variante válida e variantes de caixa de MOCKUP", () => {
  for (const nome of ["MV23704-B-.jpg", "MV27901-.JPG", "MV23704-.jpg", "MV27761 MOCKUP.jpg", "MV27760 MOCKUP.jpg", "MV27761 mockup.png", "MV27761 MockUp.webp", "MV27761.A.jpg"]) {
    assert.equal(nomeArquivoEstampaDeveSerIgnorado(nome, termos), true, nome);
  }
});

test("ponto da extensão e termos no diretório não excluem nome válido", () => {
  for (const nome of ["MV27920-C.jpg", "MV27920-F..jpg", "MV27761-E..jpg", "MV27920-f...JPG", "MV28026-D.jpg", "MV28026-d.JPG", "MV28026-A.jpg", "MV28026-E.jpg", "MV23704.jpg", "MV23704.JPG", "MV23704.webp", "MV23704.png", "MV23704", "/mockup/pasta-com.ponto/MV23704.jpg", "C:\\MOCKUP\\pasta-com.ponto\\MV23704.JPG"]) {
    assert.equal(nomeArquivoEstampaDeveSerIgnorado(nome, termos), false, nome);
  }
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("pasta/MV23704-.jpg", termos), true);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV28026-D-.jpg", termos), true);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV28026-D..jpg", termos), false);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV27920..jpg", termos), true);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV28026-D MOCKUP.jpg", termos), true);
});

test("variantes após hífen aceitam letras e números, inclusive D70", () => {
  for (const variante of ["A", "B", "D70", "d70", "AB12", "70"]) {
    for (const pontos of ["", ".", ".."]) {
      const nome = `MV27920-${variante}${pontos}.jpg`;
      assert.equal(nomeArquivoEstampaDeveSerIgnorado(nome, termos), false, nome);
    }
  }
  for (const nome of ["MV27920-D70-.jpg", "MV27920-D70 MOCKUP.jpg", "MV27920-.jpg"]) {
    assert.equal(nomeArquivoEstampaDeveSerIgnorado(nome, termos), true, nome);
  }
});

test("termos são configuráveis e literais; lista vazia desativa filtro", () => {
  assert.deepEqual(normalizarTermosIgnoradosNomeArquivo([" ", "mockup", " MOCKUP ", "-", "."]), ["MOCKUP", "-", "."]);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV23704-.jpg", []), false);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV23704 MOCKUP.jpg", ["-"]), false);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV23704 teste.jpg", [" TESTE "]), true);
  assert.equal(nomeArquivoEstampaDeveSerIgnorado("MV23704.jpg", ["%", "_", ".*"]), false);
  for (const nome of [null, undefined, "", " "]) assert.equal(nomeArquivoEstampaDeveSerIgnorado(nome, termos), false);
});

test("filtro SQL usa parâmetros literais sem interpolar termos como SQL ou regex", () => {
  const malicioso = "'); DROP TABLE estampas; --";
  const filtro = filtroNomeArquivoEstampaSql(["mockup", malicioso, ".", "-"]);
  assert.deepEqual(filtro.values, ["MOCKUP", malicioso.toUpperCase(), ".", "-"]);
  assert.doesNotMatch(filtro.sql, /DROP TABLE/);
  assert.match(filtro.sql, /strpos/);
  assert.match(filtro.sql, /estampa_filtro.id = estampa_jobs.estampa_id/);
  assert.equal(filtroNomeArquivoEstampaSql([" "]).sql, "");
});

const linhas = [
  { id: BigInt(1), originalFilename: "MV23704.jpg" },
  { id: BigInt(2), originalFilename: "MV23704-B-.jpg" },
  { id: BigInt(3), originalFilename: "MV27761 MOCKUP.jpg" },
  { id: BigInt(4), originalFilename: null, originalRelativePath: "catalogo/MV27761.A.jpg" },
].map(row => ({
  codigo: "MV23704", variante: null, previewUrl: "https://storage.googleapis.com/catalogo/imagem.jpg",
  contentHash: "hash", aiProcessedHash: null, processingStatus: "PENDING", isActive: true,
  createdAt: new Date(0), updatedAt: new Date(0), ...row,
}));
let lotes = 0;
let chamadasCriacao = 0;
let parametrosCriacao: unknown[] = [];
let parametrosClaim: unknown[] = [];
Object.assign(globalThis, { prisma: {
  estampaCatalogoIa: { findMany: async () => ++lotes === 1 ? linhas : [] },
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    if (strings.join("").includes("WITH proximo_job")) {
      parametrosClaim = values;
      return [];
    }
    chamadasCriacao++;
    parametrosCriacao = values;
    return [{ elegiveis: BigInt(1), jobsCriados: BigInt(1) }];
  },
} });

test("detector exclui nomes bloqueados antes de criar jobs, incluindo fallback de caminho", async () => {
  const { detectarEstampasPendentes } = await import("../src/services/detectarEstampasPendentesService");
  const r = await detectarEstampasPendentes({ termosIgnoradosNomeArquivo: termos });
  assert.equal(r.encontradas, 4);
  assert.equal(r.elegiveis, 1);
  assert.equal(chamadasCriacao, 1);
  const ids = parametrosCriacao.flatMap(value => value && typeof value === "object" && "values" in value ? (value as { values: unknown[] }).values : []);
  assert.ok(ids.includes(BigInt(1)));
  assert.ok(!ids.includes(BigInt(2)) && !ids.includes(BigInt(3)) && !ids.includes(BigInt(4)));
});

test("claim inclui filtro antes de assumir jobs já existentes", async () => {
  const { assumirProximoJobAiAnalysis } = await import("../src/repositories/estampa-jobs-repository");
  assert.equal(await assumirProximoJobAiAnalysis("worker-test", termos), null);
  const filtro = parametrosClaim.find(value => value && typeof value === "object" && "sql" in value) as { sql: string; values: unknown[] };
  assert.match(filtro.sql, /AND NOT EXISTS/);
  assert.deepEqual(filtro.values, [...termos]);
});
