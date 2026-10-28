import { Prisma } from "@prisma/client";
import { normalizarVariantesPermitidas } from "@/domain/filtro-variante-estampa";

export function filtroVarianteEstampaSql(permitidas: readonly string[]) {
  const variantes = normalizarVariantesPermitidas(permitidas);
  if (!variantes.length) return Prisma.empty;
  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM estampas AS estampa_variante
    WHERE estampa_variante.id = estampa_jobs.estampa_id
      AND upper(btrim(estampa_variante.variante)) IN (${Prisma.join(variantes)})
  )`;
}
