import "./helpers/next-cache";
import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "ficticio";
let app: string | null = "app-a";
let permitido = true;
let consultas = 0;
let auxiliares = 0;
Object.assign(globalThis, { prisma: {
  usuario: { findFirst: async () => ({ id: "usuario", aplicativoId: app }), findUnique: async () => ({ podeSolicitarProducao: permitido }) },
  produto: { findMany: async ({ where, select }: { where: { aplicativoId: string; ativo: boolean }; select: { imagemUrl?: boolean } }) => {
    consultas++; assert.ok(where.aplicativoId); assert.equal(where.ativo, true);
    return [{ id: where.aplicativoId, sku: "A", ...(select.imagemUrl ? { imagemUrl: "https://example.test/a.jpg" } : {}) }];
  } },
  tipoProduto: { findMany: async () => { auxiliares++; return [{ id: "tipo", sku: "T", titulo: "Tipo" }]; } },
  tamanho: { findMany: async () => { auxiliares++; return [{ id: "tamanho", sku: "M", titulo: "Médio" }]; } },
  componenteKitEstoque: { findMany: async ({ where }: { where: { aplicativoId: string } }) => {
    assert.equal(where.aplicativoId, app);
    return [{ kitSku: "KIT-A", sku: "A", quantidade: 2 }];
  } },
} });
const request = (params = "") => new Request(`https://example.test/api/produtos/opcoes?${params}`, { headers: { Authorization: "Bearer ficticio" } });

test("opções reutilizam leitura por aplicativo e perfil, mantendo autorização por requisição", async t => {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  let autorizacoes = 0;
  t.mock.method(supabaseAdmin.auth, "getUser", async () => { autorizacoes++; return { data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }; });
  const { GET } = await import("../src/app/api/produtos/opcoes/route");
  const completo = await (await GET(request())).json();
  assert.equal(completo.produtos[0].imagem_url, "https://example.test/a.jpg");
  assert.equal(completo.tiposProduto[0].codigo, "T");
  assert.equal(completo.tamanhos[0].descricao, "Médio");
  await GET(request());
  assert.equal(consultas, 1); assert.equal(autorizacoes, 2);
  const kits = await (await GET(request("incluir_kits=1"))).json();
  assert.equal(kits.produtos.find((p: { sku: string }) => p.sku === "KIT-A").componentes_kit[0].quantidade, 2);
  const antes = auxiliares;
  const edicao = await (await GET(request("perfil=edicao"))).json();
  assert.deepEqual(edicao, { produtos: [{ id: "app-a", sku: "A" }] });
  assert.equal(auxiliares, antes);
  await GET(request("perfil=edicao"));
  assert.equal(consultas, 3);
  app = "app-b";
  const outro = await (await GET(request("perfil=edicao"))).json();
  assert.equal(outro.produtos[0].id, "app-b"); assert.equal(consultas, 4);
  app = "app-a"; permitido = false;
  assert.equal((await GET(request())).status, 403);
  assert.equal(consultas, 4);
  permitido = true; app = null;
  assert.equal((await GET(request())).status, 403);
  assert.equal(consultas, 4);
});
