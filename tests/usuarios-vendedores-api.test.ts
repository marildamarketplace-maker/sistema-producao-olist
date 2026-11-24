import assert from "node:assert/strict";
import test from "node:test";
import { permissionKeys, type PermissionKey } from "../src/lib/permissions";

const app = "00000000-0000-0000-0000-000000000002";
const filho = "00000000-0000-0000-0000-000000000003";
const alheio = "00000000-0000-0000-0000-000000000099";
const administrador = "00000000-0000-0000-0000-000000000010";
const alvo = "00000000-0000-0000-0000-000000000011";
const novo = "00000000-0000-0000-0000-000000000012";
type Vinculo = { aplicativoId: string; vendedorOlistId: number };
type Usuario = { id: string; aplicativoId: string; nome: string; email: string; ativo: boolean; vinculosOlistVersao: number; vendedoresOlist: Vinculo[] } & Record<PermissionKey, boolean>;
type Where = { id?: string | { not: string }; aplicativoId?: string; email?: { equals: string } };
const permissoes = Object.fromEntries(permissionKeys.map(chave => [chave, false])) as Record<PermissionKey, boolean>;
const usuario = (id: string, nome: string): Usuario => ({ ...permissoes, id, nome, email: `${id}@example.test`, ativo: true, aplicativoId: app, vinculosOlistVersao: 2, vendedoresOlist: [] });

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
process.env.OLIST_VENDEDORES_COMPAT_LEGADO = "true";

test("usuários: cadastro normalizado, compatibilidade própria, paginação e autorização", async t => {
  const usuarios = new Map<string, Usuario>();
  let permitido = true, dentroTransacao = false, falharBanco = false, conflitoNoLock = false;
  let authCriacoes = 0, authExclusoes = 0, authAtualizacoes = 0, opcoesConsultas = 0;
  const consultasLista: Array<Record<string, unknown>> = [];
  function reiniciar() {
    usuarios.clear(); usuarios.set(administrador, usuario(administrador, "Administrador"));
    const cadastro = usuario(alvo, "Vendedor");
    cadastro.vendedoresOlist = [{ aplicativoId: app, vendedorOlistId: 10 }, { aplicativoId: filho, vendedorOlistId: 20 }];
    usuarios.set(alvo, cadastro);
    permitido = true; falharBanco = false; conflitoNoLock = false;
  }
  reiniciar();
  function encontrar(where: Where) {
    return [...usuarios.values()].find(item => (!where.aplicativoId || item.aplicativoId === where.aplicativoId)
      && (typeof where.id === "string" ? item.id === where.id : !where.id || item.id !== where.id.not)
      && (!where.email || item.email.toLowerCase() === where.email.equals.toLowerCase())) ?? null;
  }
  function projetar(item: Usuario, select: Record<string, unknown>) {
    if (select.podeEditarConfiguracao && Object.keys(select).length === 3) return { id: item.id, aplicativoId: item.aplicativoId, podeEditarConfiguracao: permitido };
    if (Object.keys(select).length === 1) return select.id ? { id: item.id } : { vinculosOlistVersao: item.vinculosOlistVersao };
    if (!select._count) return { ...item };
    const relacao = select.vendedoresOlist as { where?: { aplicativoId: string } };
    const vinculos = relacao.where ? item.vendedoresOlist.filter(v => v.aplicativoId === relacao.where?.aplicativoId) : item.vendedoresOlist;
    const dados = { id: item.id, nome: item.nome, email: item.email, ativo: item.ativo, vinculosOlistVersao: item.vinculosOlistVersao,
      _count: { vendedoresOlist: item.vendedoresOlist.length }, vendedoresOlist: vinculos.map(v => ({ ...v })) };
    return select.podeEditarConfiguracao ? { ...dados, ...Object.fromEntries(permissionKeys.map(chave => [chave, item[chave]])) } : dados;
  }
  function gravarVinculo(usuarioId: string, aplicativoId: string, vendedorId: number | null) {
    const item = usuarios.get(usuarioId); assert.ok(item);
    const anterior = item.vendedoresOlist.find(v => v.aplicativoId === aplicativoId);
    if (anterior?.vendedorOlistId === vendedorId || (!anterior && vendedorId === null)) return;
    item.vendedoresOlist = item.vendedoresOlist.filter(v => v.aplicativoId !== aplicativoId);
    if (vendedorId !== null) item.vendedoresOlist.push({ aplicativoId, vendedorOlistId: vendedorId });
    item.vinculosOlistVersao++;
  }
  const fake = {
    usuario: {
      findUnique: async ({ where, select }: { where: Where; select: Record<string, unknown> }) => {
        const item = encontrar(where); return item ? projetar(item, select) : null;
      },
      findFirst: async ({ where, select }: { where: Where; select: Record<string, unknown> }) => {
        const item = encontrar(where); return item ? projetar(item, select) : null;
      },
      findUniqueOrThrow: async ({ where, select }: { where: Where; select: Record<string, unknown> }) => {
        const item = encontrar(where); assert.ok(item); return projetar(item, select);
      },
      findMany: async (consulta: { where: Where; select: Record<string, unknown>; skip: number; take: number }) => {
        consultasLista.push(consulta); assert.equal(consulta.where.aplicativoId, app);
        assert.equal(consulta.select.podeEditarConfiguracao, undefined, "lista não carrega todas as permissões");
        return [...usuarios.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id)).slice(consulta.skip, consulta.skip + consulta.take).map(item => projetar(item, consulta.select));
      },
      count: async ({ where }: { where: Where }) => { assert.equal(where.aplicativoId, app); return usuarios.size; },
      create: async ({ data }: { data: Partial<Usuario> & { id: string; nome: string } }) => {
        assert.ok(dentroTransacao); assert.equal(data.aplicativoId, app); usuarios.set(data.id, { ...usuario(data.id, data.nome), ...data, vinculosOlistVersao: 0 }); return { id: data.id };
      },
      update: async ({ where, data, select }: { where: Where; data: Partial<Usuario>; select: Record<string, unknown> }) => {
        if (falharBanco) throw new Error("diagnóstico interno que não pode aparecer");
        assert.equal(where.aplicativoId, app);
        const item = encontrar(where); assert.ok(item); Object.assign(item, data); return projetar(item, select);
      },
    },
    aplicativo: { findMany: async () => { opcoesConsultas++; return [{ id: app, nome: "Matriz" }, { id: filho, nome: "Filial" }]; } },
    usuarioVendedorOlist: {
      upsert: async ({ create }: { create: { usuarioId: string; aplicativoId: string; vendedorOlistId: number } }) => { gravarVinculo(create.usuarioId, create.aplicativoId, create.vendedorOlistId); },
      deleteMany: async ({ where }: { where: { usuarioId: string; aplicativoId: string | { not: string; notIn: string[] } } }) => {
        const item = usuarios.get(where.usuarioId); assert.ok(item);
        const criterio = where.aplicativoId;
        for (const vinculo of [...item.vendedoresOlist]) {
          if (typeof criterio === "string" ? vinculo.aplicativoId === criterio : vinculo.aplicativoId !== criterio.not && !criterio.notIn.includes(vinculo.aplicativoId)) gravarVinculo(item.id, vinculo.aplicativoId, null);
        }
      },
    },
    $queryRaw: async (consulta: TemplateStringsArray | { values: unknown[] }, ...valores: unknown[]) => {
      assert.ok(dentroTransacao);
      if (Array.isArray(consulta)) {
        const item = usuarios.get(String(valores[0])); assert.ok(item);
        if (conflitoNoLock) { item.vinculosOlistVersao++; conflitoNoLock = false; }
        return [{ vinculosOlistVersao: item.vinculosOlistVersao }];
      }
      const ids = (consulta as { values: unknown[] }).values.slice(0, -2).map(String);
      return ids.filter(id => id === app || id === filho).map(id => ({ id }));
    },
    $executeRaw: async (consulta: TemplateStringsArray, ...valores: unknown[]) => {
      assert.ok(dentroTransacao);
      if (consulta.join("").includes("jsonb_to_recordset")) {
        const [usuarioId, dados] = valores; assert.equal(typeof usuarioId, "string"); assert.equal(typeof dados, "string");
        const vinculos = JSON.parse(String(dados)) as Vinculo[];
        for (const vinculo of vinculos) gravarVinculo(String(usuarioId), vinculo.aplicativoId, vinculo.vendedorOlistId);
        return vinculos.length;
      }
      const [vendedorId, usuarioId, aplicativoId] = valores;
      assert.ok(vendedorId === null || typeof vendedorId === "number");
      gravarVinculo(String(usuarioId), String(aplicativoId), vendedorId); return 1;
    },
  };
  Object.assign(fake, { $transaction: async <T,>(executar: (tx: typeof fake) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(usuarios); dentroTransacao = true;
      try { return await executar(fake); }
      catch (error) { usuarios.clear(); for (const [id, item] of snapshot) usuarios.set(id, item); throw error; }
      finally { dentroTransacao = false; }
    },
  });
  Object.assign(globalThis, { prisma: fake });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: administrador, email: "admin@example.test" } }, error: null }));
  t.mock.method(supabaseAdmin.auth.admin, "createUser", async () => { assert.equal(dentroTransacao, false); authCriacoes++; return { data: { user: { id: novo } }, error: null }; });
  t.mock.method(supabaseAdmin.auth.admin, "deleteUser", async () => { authExclusoes++; return { data: { user: null }, error: null }; });
  t.mock.method(supabaseAdmin.auth.admin, "updateUserById", async () => { assert.equal(dentroTransacao, false); authAtualizacoes++; return { data: { user: { id: alvo } }, error: null }; });
  const { GET, POST, PATCH } = await import("../src/app/api/usuarios/route");
  const request = (method = "GET", body?: unknown, query = "") => new Request(`https://example.test/api/usuarios${query}`, { method, headers: { Authorization: "Bearer teste" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const perfil = () => ({ nome: usuarios.get(alvo)?.nome, email: usuarios.get(alvo)?.email, ativo: true });

  await t.test("autenticação e permissão são obrigatórias também nos detalhes e opções", async () => {
    assert.equal((await GET(new Request("https://example.test/api/usuarios"))).status, 401);
    permitido = false;
    for (const query of ["", `?usuarioId=${alvo}`, "?recurso=aplicativos"]) assert.equal((await GET(request("GET", undefined, query))).status, 403);
    assert.equal(opcoesConsultas, 0); permitido = true;
  });
  await t.test("lista limitada, ordenação estável e coleção carregada somente no detalhe", async () => {
    let response = await GET(request()); assert.equal(response.status, 200);
    const lista = await response.json(); assert.equal(lista.paginacao.limite, 50); assert.equal(lista.paginacao.total, 2);
    const item = lista.usuarios.find((u: { id: string }) => u.id === alvo);
    assert.equal(item.vendedoresOlist, undefined); assert.equal(item.vendedoresOlistQuantidade, 2); assert.equal(item.vendedorOlistId, 10);
    assert.deepEqual(consultasLista[0].orderBy, [{ nome: "asc" }, { id: "asc" }]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    await GET(request("GET", undefined, "?pagina=2&limite=999")); assert.equal(consultasLista.at(-1)?.take, 100); assert.equal(consultasLista.at(-1)?.skip, 100);
    assert.equal((await GET(request("GET", undefined, "?pagina=-1"))).status, 400);
    response = await GET(request("GET", undefined, `?usuarioId=${alvo}`)); assert.equal((await response.json()).usuario.vendedoresOlist.length, 2);
    assert.equal((await GET(request("GET", undefined, `?usuarioId=${alheio}`))).status, 404);
  });
  await t.test("validação impede IDs inválidos, duplicidade e conta alheia antes de criar Authentication", async () => {
    const base = { nome: "Novo usuário", email: "novo@example.test", senha: "123456" };
    for (const vendedoresOlist of [[{ aplicativoId: filho, vendedorOlistId: 0 }], [{ aplicativoId: filho, vendedorOlistId: 2147483648 }], [{ aplicativoId: filho, vendedorOlistId: 1 }, { aplicativoId: filho, vendedorOlistId: 2 }], [{ aplicativoId: alheio, vendedorOlistId: 1 }]]) {
      assert.equal((await POST(request("POST", { ...base, vendedoresOlist }))).status, 400);
    }
    assert.equal(authCriacoes, 0);
    const response = await POST(request("POST", { ...base, vendedoresOlist: [{ aplicativoId: app, vendedorOlistId: 30 }, { aplicativoId: filho, vendedorOlistId: 40 }] }));
    assert.equal(response.status, 201); assert.equal((await response.json()).usuario.vendedoresOlist.length, 2); assert.equal(authCriacoes, 1); assert.equal(authExclusoes, 0);
  });
  await t.test("omissão preserva vínculos e legado modifica somente conta própria", async () => {
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: perfil() }))).status, 200);
    assert.equal(usuarios.get(alvo)?.vendedoresOlist.length, 2);
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), vendedorOlistId: "55" } }))).status, 200);
    assert.deepEqual(usuarios.get(alvo)?.vendedoresOlist.sort((a, b) => a.aplicativoId.localeCompare(b.aplicativoId)), [{ aplicativoId: app, vendedorOlistId: 55 }, { aplicativoId: filho, vendedorOlistId: 20 }]);
  });
  await t.test("substituição exige versão, coleção vazia limpa e conflito não sobrescreve", async () => {
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), vendedoresOlist: [] } }))).status, 400);
    const versao = usuarios.get(alvo)?.vinculosOlistVersao;
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), vendedoresOlist: [], vinculosOlistVersao: 0 } }))).status, 409);
    assert.equal(usuarios.get(alvo)?.vendedoresOlist.length, 2);
    conflitoNoLock = true;
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), vendedoresOlist: [], vinculosOlistVersao: versao } }))).status, 409);
    assert.equal(usuarios.get(alvo)?.vendedoresOlist.length, 2);
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), vendedoresOlist: [], vinculosOlistVersao: versao } }))).status, 200);
    assert.equal(usuarios.get(alvo)?.vendedoresOlist.length, 0); assert.equal(authAtualizacoes, 0);
  });
  await t.test("permissões continuam independentes e falha após Auth é explícita sem expor diagnóstico", async () => {
    assert.equal((await PATCH(request("PATCH", { usuarioId: alvo, permission: "podeCriarOlistPedido", value: true }))).status, 200);
    assert.equal(usuarios.get(alvo)?.podeCriarOlistPedido, true);
    falharBanco = true;
    const response = await PATCH(request("PATCH", { usuarioId: alvo, profile: { ...perfil(), nome: "Nome atualizado" } }));
    assert.equal(response.status, 500); const body = await response.json(); assert.match(body.error, /Authentication/); assert.doesNotMatch(body.error, /diagnóstico interno/);
    assert.equal(authAtualizacoes, 1); assert.equal(usuarios.get(alvo)?.nome, "Vendedor");
  });
});
