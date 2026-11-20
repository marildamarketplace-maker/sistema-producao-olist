import { Prisma, type PrismaClient } from "@prisma/client";

// Interface SQL pequena, também usada com PostgreSQL descartável nos testes.
export interface SqlIa {
  consultar<T>(sql: Prisma.Sql): Promise<T[]>;
  executar(sql: Prisma.Sql): Promise<number>;
}
export interface BancoIa extends SqlIa {
  transacao<T>(fn: (tx: SqlIa) => Promise<T>): Promise<T>;
}
export function adaptarSqlIa(db: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">): SqlIa {
  return { consultar: <T>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql), executar: sql => db.$executeRaw(sql) };
}
export function bancoPrismaIa(db: PrismaClient): BancoIa {
  return { ...adaptarSqlIa(db), transacao: fn => db.$transaction(tx => fn(adaptarSqlIa(tx)), { timeout: 25_000, maxWait: 5_000 }) };
}
