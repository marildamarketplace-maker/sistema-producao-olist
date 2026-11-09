import { Prisma } from "@prisma/client";

export function correspondenciaTextoEstampaSql(termos: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(e.search_vector @@ ${termos} OR e.search_vector_arquivo @@ ${termos})`;
}
