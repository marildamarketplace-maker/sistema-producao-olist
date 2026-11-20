import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarPdfBuscaSku } from "../src/lib/exportar-busca-sku";

test("PDF IA preserva quantidade longa e identifica a data do relatório", () => {
  const pdf = Buffer.from(criarPdfBuscaSku("20/11/2026", [{ sku: "001", tituloProduto: "Kit 2 lenços", tecido: "Fourway", quantidade: Number.MAX_SAFE_INTEGER }], true)).toString("latin1");
  const quantidade = [...pdf.matchAll(/BT \/F1 8 Tf 520 \d+ Td \((\d+)\) Tj ET/g)].map(m => m[1]).join("");
  assert.equal(quantidade, String(Number.MAX_SAFE_INTEGER));
  assert.match(pdf, /Data do relatório:/);
});

test("APIs IA: aceite 202, sessão, escopo, parâmetros, exportações e worker privado", async t => {
  const app = "11111111-1111-4111-8111-111111111111", busca = "22222222-2222-4222-8222-222222222222", job = "33333333-3333-4333-8333-333333333333", usuarioId = "44444444-4444-4444-8444-444444444444";
  const anterior = Reflect.get(globalThis, "prisma");
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  t.after(() => {
    if (anterior === undefined) Reflect.deleteProperty(globalThis, "prisma"); else Reflect.set(globalThis, "prisma", anterior);
    if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
  });
  let leitura = true, consultas = 0;
  const usuario = { id: usuarioId, aplicativoId: app, ativo: true };
  Object.assign(globalThis, { prisma: { usuario: { findUnique: async () => usuario, findFirst: async () => usuario }, $queryRaw: async (q: Prisma.Sql) => {
    consultas++; assert.ok(q.values.includes(app), "Toda consulta privada deve conter o aplicativo");
    if (q.text.includes("FROM usuario")) return [{ ler: leitura, escrever: false, configurar: false }];
    if (q.text.includes("FROM ia_trabalho")) return [{ id: job, total: 2, criadoEm: new Date(), finalizadoEm: new Date(), revisaoConfig: 1 }];
    if (q.text.includes("FROM ia_lote")) return [{ sku: "001", produto: "Kit 2 Lenços 70x70cm", tecido: "Fourway", quantidade: 9 }, { sku: "=1+1", produto: "=FORMULA()", tecido: "NÃO IDENTIFICADO", quantidade: 2 }];
    assert.fail("Consulta não prevista");
  } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null }));
  const { GET, POST } = await import("../src/app/api/olist/anotar-sku/[id]/relatorio-ia/route");
  const { trabalhosIa } = await import("../src/lib/trabalhos-ia/runtime");
  const criar = t.mock.method(trabalhosIa, "solicitar", async (...args: unknown[]) => { assert.deepEqual(args.slice(0, 3), [{ id: usuarioId, aplicativoId: app }, "anotar_sku.relatorio.v1", busca]); return { id: job }; });
  const contexto = { params: Promise.resolve({ id: busca }) };
  const req = (query = "", body?: unknown, auth = true) => new Request(`https://erp.test/api/olist/anotar-sku/${busca}/relatorio-ia${query}`, { method: body ? "POST" : "GET", headers: auth ? { Authorization: "Bearer teste" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(req("", undefined, false), contexto)).status, 401);
  assert.equal(consultas, 0);
  assert.equal((await POST(req("", { chave: crypto.randomUUID() }), contexto)).status, 202);
  assert.equal((await POST(req("", { chave: crypto.randomUUID(), aplicativoId: app }), contexto)).status, 400);
  assert.equal(criar.mock.callCount(), 1);
  assert.equal((await GET(req("?offset=-1"), contexto)).status, 400);
  for (const formato of ["", "csv", "xlsx", "pdf"]) {
    const response = await GET(req(formato ? `?formato=${formato}` : ""), contexto);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    if (!formato) { assert.equal((await response.json()).itens[0].sku, "001"); continue; }
    const text = Buffer.from(await response.arrayBuffer()).toString(formato === "pdf" ? "latin1" : "utf8");
    assert.match(text, /Fourway/); assert.ok(text.indexOf("001") < text.indexOf("=1+1"));
    if (formato === "csv") assert.match(text, /"'=FORMULA\(\)"/);
    if (formato === "xlsx") { assert.match(text, /TECIDO/); assert.match(text, /<c r="D4"><v>9<\/v>/); assert.ok(!text.includes("<f>")); }
    if (formato === "pdf") assert.match(text, /TECIDO/);
  }
  leitura = false; assert.equal((await GET(req(), contexto)).status, 403);
  const { POST: worker } = await import("../src/app/api/interno/trabalhos-ia/route");
  assert.equal((await worker(new Request("https://erp.test/api/interno/trabalhos-ia", { method: "POST", body: "{}" }))).status, 401);
});
