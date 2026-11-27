import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
let consultas: Prisma.Sql[] = [];
let linhas: unknown[] = [];
type ClienteTeste = {
  $queryRaw: (entrada: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]) => Promise<unknown[]>;
  $executeRaw: (entrada: Prisma.Sql) => Promise<number>;
  $transaction: <T>(executar: (tx: ClienteTeste) => Promise<T>) => Promise<T>;
};
const cliente: ClienteTeste = {
  async $queryRaw(entrada: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]) {
    consultas.push(Array.isArray(entrada) ? Prisma.sql(entrada as TemplateStringsArray, ...valores) : entrada as Prisma.Sql);
    return linhas;
  },
  async $executeRaw(entrada: Prisma.Sql) { consultas.push(entrada); return 1; },
  async $transaction<T>(executar: (tx: ClienteTeste) => Promise<T>) { return executar(cliente); },
};
Object.assign(globalThis, { prisma: cliente });
const app = "00000000-0000-4000-8000-000000000001";
const produto = "00000000-0000-4000-8000-000000000002";

test("busca pagina no banco com projeção mínima, título determinístico e isolamento", async () => {
  const { buscarProdutosEvento } = await import("../src/lib/calendario-comercial/produtos-repository");
  consultas = []; linhas = Array.from({ length: 21 }, (_, i) => ({ id: String(i), sku: String(i), titulo: "Título", ativo: true, associado: false }));
  const pagina = await buscarProdutosEvento(app, { eventoId: "natal", busca: "x%_'", pagina: 2, associados: false });
  assert.equal(pagina.produtos.length, 20); assert.equal(pagina.temMais, true);
  const q = consultas[0];
  assert.match(q.text, /p.aplicativo_id = \$\d+::uuid/);
  assert.match(q.text, /p.ativo = true/);
  assert.match(q.text, /ORDER BY po.updated_at DESC, po.id ASC LIMIT 1/);
  assert.match(q.text, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.doesNotMatch(q.text, /SELECT \*|descricao_final|imagem_url|estoque|x%_/);
  assert.ok(q.values.includes(21)); assert.ok(q.values.includes(40));
  assert.ok(q.values.includes("%x\\%\\_'%"));
  await buscarProdutosEvento(app, { eventoId: "natal", busca: "", pagina: 0, associados: true });
  assert.match(consultas[1].text, /AND v.produto_id IS NOT NULL/);
  assert.doesNotMatch(consultas[1].text, /p.ativo = true/);
});
test("contagens são agrupadas e limitadas aos eventos solicitados", async () => {
  const { contarProdutosEventos } = await import("../src/lib/calendario-comercial/produtos-repository");
  consultas = []; linhas = [{ eventoId: "natal", total: 2 }];
  assert.deepEqual(await contarProdutosEventos(app, ["natal"]), { natal: 2 });
  assert.match(consultas[0].text, /GROUP BY evento_id/);
  assert.ok(consultas[0].values.includes(app)); assert.ok(consultas[0].values.includes("natal"));
  assert.deepEqual(await contarProdutosEventos(app, []), {});
  assert.equal(consultas.length, 1);
});
test("salvamento bloqueia produtos ativos e adiciona sem duplicação; remoção é restrita ao app/evento", async () => {
  const { salvarProdutosEvento } = await import("../src/lib/calendario-comercial/produtos-repository");
  consultas = []; linhas = [{ id: produto }];
  await salvarProdutosEvento(app, { eventoId: "natal", adicionar: [produto], remover: [] });
  assert.match(consultas[2].text, /pg_advisory_xact_lock[\s\S]*::text/);
  assert.match(consultas[3].text, /ativo = true[\s\S]*FOR UPDATE/);
  assert.ok(consultas[3].values.includes(app));
  assert.match(consultas[4].text, /ON CONFLICT.*DO NOTHING/);
  consultas = []; linhas = [];
  await salvarProdutosEvento(app, { eventoId: "natal", adicionar: [], remover: [produto] });
  assert.match(consultas[3].text, /DELETE FROM[\s\S]*aplicativo_id = \$\d+::uuid AND evento_id = \$\d+/);
  assert.ok(consultas[3].values.includes(produto));
});
