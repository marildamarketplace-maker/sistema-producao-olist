import { Prisma } from "@prisma/client";
import type { FiltrosPesquisaEstampas } from "../../src/repositories/pesquisa-estampas-repository";

// Dados sintéticos em CTE: nunca cria tabelas nem altera o catálogo.
export const fixtureCategorias = `WITH estampas(id, categorias, cores, palavras_chave, is_active, processing_status) AS (VALUES
  (1, ARRAY['botânico','geométrico']::text[], ARRAY['rosa']::text[], ARRAY['flores grandes']::text[], TRUE, 'COMPLETED'),
  (2, ARRAY['botânico']::text[], ARRAY['azul']::text[], ARRAY['folhas']::text[], TRUE, 'COMPLETED'),
  (3, ARRAY['geométrico']::text[], ARRAY['rosa']::text[], ARRAY['formas']::text[], TRUE, 'COMPLETED'),
  (4, ARRAY[]::text[], ARRAY['rosa']::text[], ARRAY[]::text[], TRUE, 'COMPLETED'),
  (5, ARRAY['botânico']::text[], ARRAY['rosa']::text[], ARRAY['flores']::text[], FALSE, 'COMPLETED'),
  (6, ARRAY['botânico']::text[], ARRAY['rosa']::text[], ARRAY['flores']::text[], TRUE, 'PENDING'),
  (7, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], TRUE, 'COMPLETED')
)`;

export const casosCategorias: Array<{
  nome: string; filtros: Partial<FiltrosPesquisaEstampas>; ids: number[];
  completas: number; parciais: number; percentuais?: number[];
}> = [
  { nome: "caixa e múltiplos valores", filtros: { categoria: "BOTÂNICO" }, ids: [1, 2], completas: 0, parciais: 0 },
  { nome: "acentos preservados", filtros: { categoria: "GEOMÉTRICO" }, ids: [1, 3], completas: 0, parciais: 0 },
  { nome: "sem acento não equivale ao acentuado", filtros: { categoria: "botanico" }, ids: [], completas: 0, parciais: 0 },
  { nome: "categoria ausente não filtra", filtros: {}, ids: [1, 2, 3, 4, 7], completas: 0, parciais: 0 },
  { nome: "categoria vazia não filtra", filtros: { categoria: "  " }, ids: [1, 2, 3, 4, 7], completas: 0, parciais: 0 },
  { nome: "inexistente e arrays vazios", filtros: { categoria: "inexistente" }, ids: [], completas: 0, parciais: 0 },
  { nome: "entrada maliciosa permanece literal", filtros: { categoria: "x'); DROP TABLE estampas; --" }, ids: [], completas: 0, parciais: 0 },
  { nome: "palavra-chave continua parcial", filtros: { categoria: "BOTÂNICO", palavraChave: "FLOR" }, ids: [1], completas: 0, parciais: 0 },
  { nome: "categoria obrigatória e cor preferencial", filtros: { categoria: "BOTÂNICO", cores: ["rosa"], preferencias: ["cores"] }, ids: [1], completas: 1, parciais: 0, percentuais: [100] },
  { nome: "preferências aceitam categoria ou cor", filtros: { categoria: "BOTÂNICO", cores: ["rosa"], preferencias: ["categoria", "cores"], correspondenciaMinima: 50 }, ids: [1, 2, 3, 4], completas: 1, parciais: 3, percentuais: [100, 50, 50, 50] },
  { nome: "preferências exigem ambas a 100%", filtros: { categoria: "BOTÂNICO", cores: ["rosa"], preferencias: ["categoria", "cores"], correspondenciaMinima: 100 }, ids: [1], completas: 1, parciais: 0, percentuais: [100] },
];

const consultas: Prisma.Sql[] = [];
const prismaCaptura = {
    $queryRaw(strings: TemplateStringsArray, ...valores: unknown[]) {
      const sql = Prisma.sql(strings, ...valores);
      consultas.push(sql);
      return Promise.resolve(sql.sql.includes("COUNT(*)::BIGINT") ? [{ total: BigInt(0) }] : []);
    },
};

export async function capturarPesquisaCategoria(filtros: Partial<FiltrosPesquisaEstampas>) {
  consultas.length = 0;
  Object.assign(globalThis, { prisma: prismaCaptura });
  const { pesquisarCatalogoEstampas } = await import("../../src/repositories/pesquisa-estampas-repository");
  await pesquisarCatalogoEstampas({ ordenacao: "RELEVANCIA", limite: 24, offset: 0, status: "COMPLETED", ...filtros });
  return { lista: consultas[0], contagem: consultas[1] };
}

export function predicadoCategoriaAnterior(texto: string) {
  return texto.replace(/e\.categorias @> ARRAY\[lower\((\$\d+)\)\]::TEXT\[\]/g,
    "EXISTS (SELECT 1 FROM unnest(e.categorias) AS item WHERE lower(item) = lower($1))");
}

export function consultaCorrespondencias(textoContagem: string, preferencias: boolean) {
  const from = textoContagem.indexOf("FROM estampas AS e");
  if (from < 0) throw new Error("Consulta de contagem sem origem esperada.");
  return `SELECT e.id, ${preferencias ? "aderencia.percentual" : "NULL::double precision"} AS percentual ${textoContagem.slice(from)} ORDER BY e.id`;
}
