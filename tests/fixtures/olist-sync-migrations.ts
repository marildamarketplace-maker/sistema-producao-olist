import { readFile } from "node:fs/promises";

// O helper só precisa executar SQL. Não depende das tipagens transitivas de pg
// disponíveis em algumas instalações locais, mas ausentes no build da Vercel.
type ExecutorMigrations = { query(sql: string): Promise<unknown> };

// Somente as migrations deste módulo: o histórico geral do projeto é parcial.
const migrations = [
  "20261116000100_olist_sync_multiempresa",
  "20261117000100_olist_sync_incremental",
  "20261117000200_olist_sync_previsao",
] as const;

export async function aplicarMigrationsOlistSync(sql: ExecutorMigrations): Promise<void> {
  for (const nome of migrations) {
    const conteudo = await readFile(new URL(`../../prisma/migrations/${nome}/migration.sql`, import.meta.url), "utf8");
    await sql.query(conteudo);
  }
}
