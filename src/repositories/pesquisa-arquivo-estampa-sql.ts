import { Prisma } from "@prisma/client";

// Separa pastas, extensões e nomes compostos antes da tokenização: o parser
// padrão do PostgreSQL pode interpretar um caminho inteiro como um só lexema.
export function vetorArquivoEstampaSql(): Prisma.Sql {
  return Prisma.sql`to_tsvector('simple', regexp_replace(extensions.unaccent(
    COALESCE(e.original_filename, '') || ' ' ||
    COALESCE(e.original_relative_path, '') || ' ' ||
    COALESCE(e.storage_key, '')
  ), '[^[:alnum:]]+', ' ', 'g'))`;
}

export function correspondenciaTextoEstampaSql(termos: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(COALESCE(e.search_vector @@ ${termos}, FALSE)
    OR ${vetorArquivoEstampaSql()} @@ ${termos})`;
}
