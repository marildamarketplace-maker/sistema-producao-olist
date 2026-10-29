import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { Prisma } from "@prisma/client";

const registro = {
  id: BigInt(1), codigo: "TESTE", variante: null,
  createdAt: new Date(0), updatedAt: new Date(0),
  conteudosImagem: [], tipoImagem: "INDEFINIDO", suporteAplicacao: "NAO_APLICAVEL",
  categorias: ["categoria anterior"], aiMetadata: null,
};
const gravacoes: Prisma.EstampaCatalogoIaUpdateManyArgs[] = [];
let leituras = 0;
Object.assign(globalThis, { prisma: { estampaCatalogoIa: {
  findUnique: async () => { leituras += 1; return registro; },
  updateMany: async (args: Prisma.EstampaCatalogoIaUpdateManyArgs) => {
    gravacoes.push(args);
    return { count: 1 };
  },
} } });
beforeEach(() => { gravacoes.length = 0; leituras = 0; });

test("grava categorias em minúsculas preservando acentos, ordem e entrada original", async () => {
  const { atualizarEstampa } = await import("../src/repositories/catalogo-estampas-repository");
  const categorias = ["  BOTÂNICO ", "GEOME\u0301TRICO", "botânico", "Ação  de Graças", " "];
  const original = [...categorias];
  await atualizarEstampa("1", { categorias }, { contentHashEsperado: "hash-atual" });
  assert.deepEqual(gravacoes[0].data.categorias, ["botânico", "geométrico", "ação de graças"]);
  assert.deepEqual(categorias, original);
  assert.deepEqual(Object.keys(gravacoes[0].data).sort(), ["categorias", "textoPesquisa"]);
  assert.equal(gravacoes[0].where?.contentHash, "hash-atual");
});

test("normalização de categorias não altera outros valores enviados", async () => {
  const { atualizarEstampa } = await import("../src/repositories/catalogo-estampas-repository");
  const cores = ["AZUL Marinho"], palavras = ["FLORES"], metadata = { response: { categorias: ["BOTÂNICO"] } };
  await atualizarEstampa("1", {
    categorias: ["BOTÂNICO"], titulo: "Título ORIGINAL", tema: "TEMA ORIGINAL",
    cores, palavras_chave: palavras, ai_metadata: metadata,
  });
  const data = gravacoes[0].data;
  assert.deepEqual(data.categorias, ["botânico"]);
  assert.equal(data.titulo, "Título ORIGINAL");
  assert.equal(data.tema, "TEMA ORIGINAL");
  assert.deepEqual(data.cores, cores);
  assert.deepEqual(data.palavrasChave, palavras);
  assert.deepEqual(data.aiMetadata, metadata);
});

test("categoria omitida não normaliza nem regrava categorias existentes", async () => {
  const { atualizarEstampa } = await import("../src/repositories/catalogo-estampas-repository");
  await atualizarEstampa("1", { processing_status: "PENDING" });
  assert.deepEqual(gravacoes[0].data, { processingStatus: "PENDING" });
  assert.equal(leituras, 1);
});

test("null e lista vazia preservam a semântica de limpar categorias", async () => {
  const { atualizarEstampa } = await import("../src/repositories/catalogo-estampas-repository");
  await atualizarEstampa("1", { categorias: null });
  await atualizarEstampa("1", { categorias: [] });
  for (const gravacao of gravacoes) assert.deepEqual(gravacao.data.categorias, []);
});

test("categorias inválidas falham antes de acessar o banco", async () => {
  const { atualizarEstampa } = await import("../src/repositories/catalogo-estampas-repository");
  for (const valor of ["BOTÂNICO", [1], [null], {}]) {
    await assert.rejects(atualizarEstampa("1", { categorias: valor as unknown as string[] }), /lista de textos/);
  }
  assert.equal(leituras, 0);
  assert.equal(gravacoes.length, 0);
});
