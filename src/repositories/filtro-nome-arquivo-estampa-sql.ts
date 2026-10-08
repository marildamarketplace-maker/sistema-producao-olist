import { Prisma } from "@prisma/client";
import { normalizarTermosIgnoradosNomeArquivo } from "@/domain/filtro-nome-arquivo-estampa";

export function filtroNomeArquivoEstampaSql(termos: readonly string[]) {
  const normalizados = normalizarTermosIgnoradosNomeArquivo(termos);
  if (!normalizados.length) return Prisma.empty;
  // Mesmo contrato do filtro de domínio. Termos são parâmetros literais,
  // nunca padrões de LIKE/regex ou texto interpolado no SQL.
  return Prisma.sql`AND NOT EXISTS (
    SELECT 1
    FROM estampas AS estampa_filtro,
         unnest(ARRAY[${Prisma.join(normalizados)}]::text[]) AS termo(valor)
    CROSS JOIN LATERAL (
      SELECT upper(regexp_replace(
        regexp_replace(replace(btrim(COALESCE(
          NULLIF(btrim(estampa_filtro.original_filename), ''),
          NULLIF(btrim(estampa_filtro.original_relative_path), ''),
          estampa_filtro.storage_key
        )), chr(92), '/'), '^.*/', ''), '[.][^.]*$', ''
      )) AS sem_extensao
    ) AS nome
    WHERE estampa_filtro.id = estampa_jobs.estampa_id
      AND CASE WHEN termo.valor = '-' THEN right(nome.sem_extensao, 1) = '-'
          ELSE strpos(nome.sem_extensao, termo.valor) > 0 END
  )`;
}
