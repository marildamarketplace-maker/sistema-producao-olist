import { readFile } from "node:fs/promises";
import type { Client } from "pg";

// Somente as migrations deste módulo: o histórico geral do projeto é parcial.
const migrations = [
  "20261116000100_olist_sync_multiempresa",
  "20261117000100_olist_sync_incremental",
  "20261117000200_olist_sync_previsao",
] as const;

export async function aplicarMigrationsOlistSync(sql: Pick<Client, "query">): Promise<void> {
  for (const nome of migrations) {
    const conteudo = await readFile(new URL(`../../prisma/migrations/${nome}/migration.sql`, import.meta.url), "utf8");
    await sql.query(conteudo);
  }
}
