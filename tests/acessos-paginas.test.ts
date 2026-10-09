import assert from "node:assert/strict";
import test from "node:test";
import { criarHandlersAcessos } from "../src/lib/acessos-paginas";
import { paginas, rankingPaginas } from "../src/lib/navigation";

test("ranking pessoal decrescente, desempate estável e permissões atuais", () => {
  const usuario = { podeVisualizarEstoque: true };
  const ranking = rankingPaginas(usuario, [
    { pagina: "/estoque", acessos: 8 }, { pagina: "/produtos", acessos: 3 },
    { pagina: "/usuarios", acessos: 999 },
  ]);
  assert.equal(ranking[0].href, "/estoque");
  assert.equal(ranking[1].href, "/produtos");
  assert.ok(!ranking.some((p) => p.href === "/usuarios"));
  assert.deepEqual(rankingPaginas(usuario, []), rankingPaginas(usuario, []));
  assert.equal(new Set(paginas.map((p) => p.href)).size, paginas.length);
});

test("sem token não consulta ou incrementa", async () => {
  const handlers = criarHandlersAcessos({ autenticar: async () => null,
    listar: async () => { throw new Error("Não deveria consultar"); },
    incrementar: async () => { throw new Error("Não deveria gravar"); } });
  assert.equal((await handlers.GET(new Request("http://localhost"))).status, 401);
  assert.equal((await handlers.POST(new Request("http://localhost", { method: "POST" }))).status, 401);
});

test("POST usa identidade do servidor e rejeita páginas arbitrárias ou proibidas", async () => {
  const gravacoes: string[][] = [];
  const handlers = criarHandlersAcessos({ autenticar: async () => ({ id: "usuario-A", podeVisualizarEstoque: true }),
    listar: async () => [], incrementar: async (id, pagina) => { gravacoes.push([id, pagina]); } });
  const post = (body: unknown) => handlers.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }));
  assert.equal((await post({ pagina: "/estoque", usuarioId: "usuario-B", acessos: 99 })).status, 204);
  assert.deepEqual(gravacoes, [["usuario-A", "/estoque"]]);
  for (const pagina of ["/usuarios", "/login", "/", "/estoque?q=x", "https://example.com", null]) {
    assert.equal((await post({ pagina })).status, 403);
  }
  assert.equal((await post(null)).status, 403);
  assert.equal((await handlers.POST(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
  assert.equal(gravacoes.length, 1);
});

test("GET consulta somente o usuário autenticado, filtra permissões e impede cache", async () => {
  const handlers = criarHandlersAcessos({ autenticar: async () => ({ id: "A", podeVisualizarDashboard: true }),
    listar: async (id) => { assert.equal(id, "A"); return [{ pagina: "/dashboard", acessos: 5 }, { pagina: "/usuarios", acessos: 100 }]; },
    incrementar: async () => {} });
  const response = await handlers.GET(new Request("http://localhost"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.paginas[0].href, "/dashboard");
  assert.equal(data.paginas[0].acessos, 5);
  assert.ok(!data.paginas.some((p: {href: string}) => p.href === "/usuarios"));
});

test("falhas não expõem detalhes internos", async () => {
  const handlers = criarHandlersAcessos({ autenticar: async () => { throw new Error("secret"); }, listar: async () => [], incrementar: async () => {} });
  const response = await handlers.GET(new Request("http://localhost"));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("secret"));
});
