import { Prisma } from "@prisma/client";
import type { ReferenciaFotoEstampa } from "@/domain/referencia-foto-estampa";
import { correspondenciaEstampasSql } from "./correspondencia-estampas-sql";
import { filtrosDesignEstampasSql } from "./filtros-design-estampas-sql";

export function criteriosReferenciaFotoSql(foto?: ReferenciaFotoEstampa): Array<{ termo: string; teste: Prisma.Sql }> {
  if (!foto) return [];
  const criterios: Array<{ termo: string; teste: Prisma.Sql }> = [];
  for (const motivo of foto.motivos) {
    // Frases literais: o conteúdo reconhecido nunca se transforma em operador ou código de produto.
    const frase = motivo.replace(/["\\-]/g, " ").trim();
    if (!frase) continue;
    const testes = correspondenciaEstampasSql(`"${frase}"`, [], false).obrigatorios;
    if (testes.length) criterios.push({ termo: `Foto · motivo: ${motivo}`, teste: Prisma.sql`(${Prisma.join(testes, " AND ")})` });
  }
  if (foto.tema) criterios.push({ termo: `Foto · tema: ${foto.tema}`, teste: Prisma.sql`lower(e.tema) = lower(${foto.tema})` });
  if (foto.cores.length) criterios.push({ termo: `Foto · cores: ${foto.cores.join(" ou ")}`,
    teste: Prisma.sql`e.cores && ARRAY[${Prisma.join(foto.cores)}]::text[]` });
  for (const campo of ["estilo", "distribuicao", "linguagemVisual"] as const) {
    if (!foto[campo]) continue;
    const testes = filtrosDesignEstampasSql({ [campo]: foto[campo] });
    if (testes.length) criterios.push({ termo: `Foto · ${campo}: ${foto[campo]}`, teste: Prisma.sql`(${Prisma.join(testes, " AND ")})` });
  }
  return criterios;
}
