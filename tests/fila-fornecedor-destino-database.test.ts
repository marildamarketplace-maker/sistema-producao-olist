import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { bloquearDestinoFornecedor, destinoFornecedorWhere } from "../src/lib/fila-fornecedor-destino";
import { criarPostgresMemoria } from "./helpers/postgres-memoria";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("destino fornecedor aceita conta independente/própria e filhos, rejeita netos e outro grupo", async () => {
  const db = criarPostgresMemoria();
  const proprio = id(1), filho = id(2), neto = id(3), alheio = id(4), isolado = id(5);
  try {
    await db.exec("CREATE TABLE aplicativo(id uuid PRIMARY KEY,aplicativo_pai_id uuid REFERENCES aplicativo(id))");
    await db.query("INSERT INTO aplicativo VALUES ($1,null),($2,null),($3,null)",[proprio,alheio,isolado]);
    await db.query("INSERT INTO aplicativo VALUES ($1,$2),($3,$1)",[filho,proprio,neto]);
    const consultas: Prisma.Sql[] = [];
    const tx = { $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = Prisma.sql(strings,...valores); consultas.push(sql);
      return (await db.query(sql.text,sql.values)).rows;
    } } as unknown as Pick<Prisma.TransactionClient,"$queryRaw">;
    await db.exec("BEGIN");
    assert.equal(await bloquearDestinoFornecedor(tx,proprio,proprio),true);
    assert.equal(await bloquearDestinoFornecedor(tx,proprio,filho),true);
    assert.equal(await bloquearDestinoFornecedor(tx,isolado,isolado),true,"conta sem filhos continua selecionável");
    assert.equal(await bloquearDestinoFornecedor(tx,proprio,neto),false);
    assert.equal(await bloquearDestinoFornecedor(tx,proprio,alheio),false);
    assert.equal(await bloquearDestinoFornecedor(tx,filho,proprio),false,"filho não acessa a conta pai");
    assert.equal(await bloquearDestinoFornecedor(tx,proprio,id(99)),false);
    await db.exec("COMMIT");
    for (const sql of consultas) {
      assert.match(sql.text,/^SELECT id FROM aplicativo/);
      assert.match(sql.text,/FOR SHARE/);
      assert.equal(sql.values.length,3);
    }
    assert.deepEqual(destinoFornecedorWhere(proprio,filho),{
      id:filho,OR:[{id:proprio},{aplicativoPaiId:proprio}],
    });
    assert.deepEqual(destinoFornecedorWhere(isolado,isolado),{
      id:isolado,OR:[{id:isolado},{aplicativoPaiId:isolado}],
    });
  } finally { await db.close(); }
});
