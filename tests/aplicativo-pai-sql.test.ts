import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

test("migração vincula filiais e protege a integridade do aplicativo pai", {
  skip: !process.env.APLICATIVO_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.APLICATIVO_TEST_DATABASE_URL });
  const id = (suffix: number) => `00000000-0000-0000-0000-${String(suffix).padStart(12, "0")}`;
  await client.connect();
  try {
    // A tabela temporária oculta a tabela real apenas nesta conexão.
    await client.query(`CREATE TEMP TABLE aplicativo (
      id uuid PRIMARY KEY, nome text NOT NULL, updated_at timestamptz DEFAULT now()
    )`);
    for (const [suffix, nome] of [
      [1, "Meury Shop"], [2, "MV Tecidos"], [3, "MV PRINTS MATRIZ"],
      [4, "MV PRINTS FILIAL"], [5, "SEU OLHAR"],
    ] as const) {
      await client.query("INSERT INTO aplicativo (id, nome) VALUES ($1, $2)", [id(suffix), nome]);
    }
    await client.query(await readFile(new URL(
      "../prisma/migrations/20261016180000_add_aplicativo_pai/migration.sql", import.meta.url,
    ), "utf8"));
    const { rows } = await client.query("SELECT id, aplicativo_pai_id FROM aplicativo ORDER BY id");
    assert.deepEqual(rows.map((row) => row.aplicativo_pai_id), [null, null, id(2), id(2), id(2)]);
    await assert.rejects(client.query("DELETE FROM aplicativo WHERE id = $1", [id(2)]), { code: "23503" });
    await assert.rejects(client.query(
      "UPDATE aplicativo SET aplicativo_pai_id = $1 WHERE id = $2", [id(99), id(1)],
    ), { code: "23503" });
    await assert.rejects(client.query(
      "UPDATE aplicativo SET aplicativo_pai_id = id WHERE id = $1", [id(1)],
    ), { code: "23514" });
    assert.equal((await client.query("SELECT count(*)::int AS total FROM aplicativo")).rows[0].total, 5);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
