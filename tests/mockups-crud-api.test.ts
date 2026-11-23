import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("API cadastra, consulta, atualiza e exclui mockups com escopo e prompt", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  process.env.MOCKUPS_BLOB_STORE_ID = "store_mockups";

  const aplicativoId = "tenant-mockups";
  const usuarioId = "usuario-mockups";
  let consultaLista: Record<string, unknown> = {};
  let salvo: Record<string, unknown> | null = null;
  let usoAtivo = false;
  let removido = false;
  const caminhosEnviados: string[] = [];
  const queryUnica = async () => [{ existe: usoAtivo }];
  Object.assign(globalThis, { prisma: {
    usuario: {
      findFirst: async () => ({ id: usuarioId, ativo: true, aplicativoId }),
      findUnique: async () => ({
        ativo: true, aplicativoId, podeVisualizarCategoriasMidia: false, podeCriarMockups: true,
      }),
    },
    mockupCatalogo: {
      findMany: async (query: Record<string, unknown>) => { consultaLista = query; return []; },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        salvo = { ...data, ativo: true };
        return data;
      },
      findUnique: async () => salvo,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        salvo = { ...salvo, ...data };
        return salvo;
      },
      delete: async () => { salvo = null; return { id: "apagado" }; },
    },
    $queryRaw: queryUnica,
  } });

  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({
    data: { user: { id: usuarioId, email: "teste@example.test" } }, error: null,
  }));
  const { mockupBlobStorage } = await import("../src/services/mockupBlobStorageService");
  t.mock.method(mockupBlobStorage, "enviar", async ({ path }: { path: string }) => {
    caminhosEnviados.push(path);
    return { bucket: "store_mockups", path };
  });
  t.mock.method(mockupBlobStorage, "ler", async () => new Response("webp").body!);
  t.mock.method(mockupBlobStorage, "remover", async () => { removido = true; });

  const { POST, GET, PATCH, DELETE } = await import("../src/app/api/controle-midia/mockups/route");
  const listar = (query: string) => GET(new Request(`https://example.test/api/controle-midia/mockups?${query}`, {
    headers: { Authorization: "Bearer teste" },
  }));
  const filtrada = await listar("incluirInformativos=1&nome=Forro&categoria=Mesa&tipo=LAYOUT");
  assert.equal(filtrada.status, 200);
  assert.deepEqual(consultaLista.where, { AND: [
    { aplicativoId, ativo: true },
    { nome: { contains: "Forro", mode: "insensitive" } },
    { categoria: { contains: "Mesa", mode: "insensitive" } },
    { tipo: "LAYOUT" },
  ] });
  assert.equal(consultaLista.take, 25);
  assert.deepEqual(consultaLista.select, { id: true, nome: true, tipo: true, categoria: true, createdAt: true });
  assert.deepEqual(consultaLista.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  const cursor = Buffer.from(JSON.stringify({ createdAt: "2026-11-23T12:00:00.000Z", id: "ultimo" })).toString("base64url");
  assert.equal((await listar(`nome=Forro&cursor=${cursor}`)).status, 200);
  const condicoes = (consultaLista.where as { AND: unknown[] }).AND;
  assert.ok(condicoes.some((item) => JSON.stringify(item).includes('"contains":"Forro"')));
  assert.ok(condicoes.some((item) => JSON.stringify(item).includes('"id":{"lt":"ultimo"}')));
  for (const query of ["tipo=INVALIDO", `nome=${"a".repeat(181)}`, `categoria=${"a".repeat(501)}`]) {
    assert.equal((await listar(query)).status, 400);
  }
  assert.equal((await listar("incluirInformativos=1")).status, 200);
  assert.deepEqual(consultaLista.where, { AND: [{ aplicativoId, ativo: true }] });

  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const headers = {
    Authorization: "Bearer teste",
    "Content-Type": "application/octet-stream",
    "x-mockup-nome": encodeURIComponent("Forro de mesa"),
    "x-mockup-tipo": "INDIVIDUAL",
    "x-mockup-categoria": encodeURIComponent("Forro retangular"),
    "x-mockup-observacao-prompt": encodeURIComponent("Continuidade da estampa no tampo e nas laterais."),
  };
  const criado = await POST(new Request("https://example.test/api/controle-midia/mockups", { method: "POST", headers, body: png }));
  assert.equal(criado.status, 201);
  const respostaCriacao = await criado.json() as { mockup: { id: string; observacaoPrompt: string } };
  assert.equal(respostaCriacao.mockup.observacaoPrompt, "Continuidade da estampa no tampo e nas laterais.");
  assert.equal((salvo as unknown as { aplicativoId: string }).aplicativoId, aplicativoId);
  assert.equal(caminhosEnviados.length, 1);

  const detalhe = await GET(new Request(`https://example.test/api/controle-midia/mockups?detalhesId=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    headers: { Authorization: "Bearer teste" },
  }));
  assert.equal(detalhe.status, 200);
  assert.equal((await detalhe.json() as { mockup: { observacaoPrompt: string } }).mockup.observacaoPrompt,
    "Continuidade da estampa no tampo e nas laterais.");
  const imagem = await GET(new Request(`https://example.test/api/controle-midia/mockups?id=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    headers: { Authorization: "Bearer teste" },
  }));
  assert.equal(imagem.headers.get("content-type"), "image/webp");

  const atualizada = await PATCH(new Request(`https://example.test/api/controle-midia/mockups?id=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    method: "PATCH", headers: { Authorization: "Bearer teste", "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Forro retangular", tipo: "INDIVIDUAL", categoria: "Mesa", observacaoPrompt: "Preservar a queda lateral.",
    }),
  }));
  assert.equal(atualizada.status, 200);
  assert.equal((await atualizada.json() as { mockup: { observacaoPrompt: string } }).mockup.observacaoPrompt,
    "Preservar a queda lateral.");
  const tipoAlterado = await PATCH(new Request(`https://example.test/api/controle-midia/mockups?id=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    method: "PATCH", headers: { Authorization: "Bearer teste", "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "Layout", tipo: "LAYOUT", categoria: "Mesa", observacaoPrompt: "" }),
  }));
  assert.equal(tipoAlterado.status, 422);

  usoAtivo = true;
  const bloqueado = await DELETE(new Request(`https://example.test/api/controle-midia/mockups?id=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    method: "DELETE", headers: { Authorization: "Bearer teste" },
  }));
  assert.equal(bloqueado.status, 409);
  assert.equal(removido, false);
  usoAtivo = false;
  const excluido = await DELETE(new Request(`https://example.test/api/controle-midia/mockups?id=${encodeURIComponent(respostaCriacao.mockup.id)}`, {
    method: "DELETE", headers: { Authorization: "Bearer teste" },
  }));
  assert.equal(excluido.status, 200);
  assert.equal(removido, true);
  assert.equal(salvo, null);
});
