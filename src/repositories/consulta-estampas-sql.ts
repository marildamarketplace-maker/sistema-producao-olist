import { Prisma } from "@prisma/client";

// Aplica prefixos aos lexemas já escapados pelo PostgreSQL, preservando
// operadores e posições de frases gerados pela expansão de sinônimos.
export function consultaEstampasSql(consulta: string): Prisma.Sql {
  if (!consulta) return Prisma.sql`NULL::tsquery`;
  return Prisma.sql`to_tsquery('simple', regexp_replace(
    websearch_to_tsquery('simple', extensions.unaccent(${consulta}))::text,
    ${String.raw`('(?:[^'\\]|\\.|'')*')`},
    ${String.raw`\1:*`},
    'g'
  ))`;
}
