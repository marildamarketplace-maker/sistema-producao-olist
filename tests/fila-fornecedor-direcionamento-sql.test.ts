import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

test("migration de direcionamento preserva fila antiga e exige atribuição completa e chaves válidas", {
  skip: !process.env.APLICATIVO_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.APLICATIVO_TEST_DATABASE_URL });
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await client.connect();
  try {
    // Tabelas temporárias ocultam as reais apenas nesta conexão.
    await client.query('CREATE TEMP TABLE aplicativo (id uuid PRIMARY KEY)');
    await client.query('CREATE TEMP TABLE usuario (id uuid PRIMARY KEY)');
    await client.query('CREATE TEMP TABLE pedido_fornecedor_queue (id uuid PRIMARY KEY, dados_pedido jsonb NOT NULL)');
    await client.query('INSERT INTO aplicativo VALUES ($1)', [id(1)]);
    await client.query('INSERT INTO usuario VALUES ($1)', [id(2)]);
    await client.query('INSERT INTO pedido_fornecedor_queue VALUES ($1, $2)', [id(3), JSON.stringify({ versao: 1, itens: [] })]);
    await client.query(await readFile(new URL('../prisma/migrations/20261016190000_direcionamento_fila_fornecedor/migration.sql', import.meta.url), 'utf8'));
    const antes = (await client.query('SELECT * FROM pedido_fornecedor_queue')).rows[0];
    assert.equal(antes.aplicativo_filial_id, null);
    assert.equal(antes.direcionado_por_id, null);
    assert.equal(antes.direcionado_em, null);
    assert.equal(antes.versao, 0);
    await assert.rejects(client.query('UPDATE pedido_fornecedor_queue SET aplicativo_filial_id = $1', [id(1)]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pedido_fornecedor_queue SET versao = -1'), { code: '23514' });
    await assert.rejects(client.query('UPDATE pedido_fornecedor_queue SET aplicativo_filial_id = $1, direcionado_por_id = $2, direcionado_em = now()', [id(99), id(2)]), { code: '23503' });
    await assert.rejects(client.query('UPDATE pedido_fornecedor_queue SET aplicativo_filial_id = $1, direcionado_por_id = $2, direcionado_em = now()', [id(1), id(99)]), { code: '23503' });
    await client.query('UPDATE pedido_fornecedor_queue SET aplicativo_filial_id = $1, direcionado_por_id = $2, direcionado_em = now(), versao = versao + 1', [id(1), id(2)]);
    const depois = (await client.query('SELECT * FROM pedido_fornecedor_queue')).rows[0];
    assert.equal(depois.aplicativo_filial_id, id(1));
    assert.equal(depois.direcionado_por_id, id(2));
    assert.equal(depois.versao, 1);
    assert.deepEqual(depois.dados_pedido, antes.dados_pedido);
  } finally { await client.end(); }
});
