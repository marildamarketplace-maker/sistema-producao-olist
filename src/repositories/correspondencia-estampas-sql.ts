import { Prisma } from "@prisma/client";
import { planejarConsultaEstampas, type CriterioConsultaEstampas } from "@/domain/consulta-profissional-estampas";
import { consultaEstampasSql } from "@/repositories/consulta-estampas-sql";

export function correspondenciaEstampasSql(consulta: string, adicionais: Array<{ termo: string; teste: Prisma.Sql }> = [], consultaPreferencia = true) {
  const plano = planejarConsultaEstampas(consulta);
  const obrigatorios = plano.positivos.filter((item) => item.codigo || !consultaPreferencia).map(testeCriterio);
  if (!plano.positivos.filter((item) => !item.codigo && consultaPreferencia).length && !adicionais.length) return {
    plano, obrigatorios, criterios: [], candidatos: Prisma.empty, exclusoes: plano.excluidos.map((item) => Prisma.sql`NOT (${testeCriterio(item)})`), percentual: Prisma.sql`NULL::DOUBLE PRECISION`,
    encontrados: Prisma.sql`ARRAY[]::TEXT[]`, ausentes: Prisma.sql`ARRAY[]::TEXT[]`, termos: Prisma.sql`NULL::tsquery`,
  };
  const criterios = [...plano.positivos.filter((item) => !item.codigo && consultaPreferencia).map((item) => ({ item, teste: testeCriterio(item) })), ...adicionais.map(({ termo, teste }) => ({ item: { termo, consulta: "", codigo: null }, teste }))];
  // A seleção inicial usa OR entre tsqueries para aproveitar o índice GIN.
  const textuais = plano.positivos.filter((item) => !item.codigo && consultaPreferencia);
  const termos = textuais.length ? Prisma.sql`(${Prisma.join(textuais.map((item) => consultaEstampasSql(item.consulta)), " || ")})` : Prisma.sql`NULL::tsquery`;
  const candidatos: Prisma.Sql[] = textuais.length ? [Prisma.sql`e.search_vector @@ ${termos}`] : [];
  candidatos.push(...adicionais.map(({ teste }) => teste));
  const quantidade = Prisma.sql`(${Prisma.join(criterios.map(({ teste }) => Prisma.sql`CASE WHEN ${teste} THEN 1 ELSE 0 END`), " + ")})`;
  return {
    plano, obrigatorios, criterios: criterios.map(({ item }) => item.termo),
    termos,
    candidatos: Prisma.sql`(${Prisma.join(candidatos, " OR ")})`,
    exclusoes: plano.excluidos.map((item) => Prisma.sql`NOT (${testeCriterio(item)})`),
    percentual: Prisma.sql`ROUND(${quantidade} * 100.0 / ${criterios.length}, 1)::DOUBLE PRECISION`,
    encontrados: Prisma.sql`array_remove(ARRAY[${Prisma.join(criterios.map(({ item, teste }) => Prisma.sql`CASE WHEN ${teste} THEN ${item.termo} ELSE NULL END`))}]::TEXT[], NULL)`,
    ausentes: Prisma.sql`array_remove(ARRAY[${Prisma.join(criterios.map(({ item, teste }) => Prisma.sql`CASE WHEN ${teste} THEN NULL ELSE ${item.termo} END`))}]::TEXT[], NULL)`,
  };
}

function testeCriterio(item: CriterioConsultaEstampas): Prisma.Sql {
  if (item.codigo) {
    return item.codigo.variante
      ? Prisma.sql`(lower(e.codigo) = lower(${item.codigo.codigo}) AND lower(COALESCE(e.variante, '')) = lower(${item.codigo.variante}))`
      : Prisma.sql`lower(e.codigo) = lower(${item.codigo.codigo})`;
  }
  return Prisma.sql`COALESCE(e.search_vector @@ ${consultaEstampasSql(item.consulta)}, FALSE)`;
}
