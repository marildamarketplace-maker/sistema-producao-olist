import { createRequire } from "node:module";

export type BancoMemoria = {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

// Usa o PostgreSQL WASM já trazido pela versão travada do Prisma; sem URL de banco.
export function criarPostgresMemoria(): BancoMemoria {
  const require = createRequire(import.meta.url);
  const prismaRequire = createRequire(require.resolve("prisma/package.json"));
  const devRequire = createRequire(prismaRequire.resolve("@prisma/dev"));
  const { PGlite } = devRequire("@electric-sql/pglite") as { PGlite: new () => BancoMemoria };
  return new PGlite();
}
