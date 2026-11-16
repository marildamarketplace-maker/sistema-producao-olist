import { Prisma } from "@prisma/client";
import { normalizarVariantesPermitidas } from "@/domain/filtro-variante-estampa";

export function filtroVarianteEstampaSql(permitidas: readonly string[], estampaId: Prisma.Sql = Prisma.sql`estampa_jobs.estampa_id`) {
  const variantes = normalizarVariantesPermitidas(permitidas);
  if (!variantes.length) return Prisma.empty;
  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM estampas AS estampa_variante
    WHERE estampa_variante.id = ${estampaId}
      AND upper(btrim(estampa_variante.variante)) IN (${Prisma.join(variantes)})
  )`;
}
