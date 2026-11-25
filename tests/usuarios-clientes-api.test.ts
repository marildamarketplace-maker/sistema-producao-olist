import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const matriz = id(1), cliente = id(2), admin = id(3), alvo = id(4), filho = id(5);

test("usuários clientes: lista limitada e detalhe restrito à relação ativa e ao grupo fornecedor", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  let permitido = true, filialAdmin = false, ativa = true, versao = 8, revogarNoLock = false;
  const vinculos = [
    { aplicativoId: matriz, vendedorOlistId: 123, confirmadoEm: new Date() as Date | null, revogadoEm: null as Date | null, fornecedorMatrizId: matriz },
    { aplicativoId: filho, vendedorOlistId: 456, confirmadoEm: new Date() as Date | null, revogadoEm: new Date() as Date | null, fornecedorMatrizId: matriz },
    { aplicativoId: id(99), vendedorOlistId: 999, confirmadoEm: new Date() as Date | null, revogadoEm: null as Date | null, fornecedorMatrizId: id(99) },
  ];
  const chamadas: Array<{ recurso: string; consulta: Record<string, unknown> }> = [];
  const pessoa = { id: alvo, nome: "Usuário cliente", aplicativoId: cliente, aplicativo: { id: cliente, nome: "Meuryshop" } };
  const contasExternas = { AND: [
    { OR: [{ id: matriz }, { aplicativoPaiId: matriz }] },
    { id: { not: cliente } },
    { OR: [{ aplicativoPaiId: null }, { aplicativoPaiId: { not: cliente } }] },
  ] };
  const fake = {
    usuario: {
      findFirst: async (consulta: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        chamadas.push({ recurso: "usuario.findFirst", consulta });
        if (!consulta.where.aplicativo) return { id: admin, ativo: true, aplicativoId: matriz };
        assert.deepEqual(consulta.where.aplicativo, { fornecedores: { some: { aplicativoPaiId: matriz, ativo: true } } });
        assert.deepEqual(consulta.select, { id: true, nome: true, aplicativoId: true, aplicativo: { select: { id: true, nome: true } } });
        return ativa && consulta.where.id === alvo ? pessoa : null;
      },
      findUnique: async () => ({ id: admin, ativo: true, aplicativoId: matriz, podeEditarConfiguracao: permitido,
        aplicativo: { aplicativoPaiId: filialAdmin ? id(90) : null } }),
      findUniqueOrThrow: async () => ({ vinculosOlistVersao: versao }),
      findMany: async (consulta: Record<string, unknown>) => { chamadas.push({ recurso: "usuario.findMany", consulta }); return [pessoa]; },
      count: async (consulta: Record<string, unknown>) => { chamadas.push({ recurso: "usuario.count", consulta }); return 1; },
    },
    usuarioVendedorOlist: { findMany: async (consulta: Record<string, unknown>) => {
      chamadas.push({ recurso: "vinculo.findMany", consulta });
      assert.deepEqual(consulta.where, { usuarioId: alvo, origemAplicativoId: cliente, fornecedorMatrizId: matriz,
        aplicativo: contasExternas });
      return vinculos.filter(v => v.fornecedorMatrizId === matriz);
    }, updateMany: async ({ where, data }: {where:{usuarioId:string;origemAplicativoId:string;fornecedorMatrizId:string;revogadoEm:null;aplicativoId:{notIn:string[]}};data:{revogadoEm:Date}}) => {
      assert.equal(where.usuarioId, alvo); assert.equal(where.origemAplicativoId, cliente); assert.equal(where.fornecedorMatrizId, matriz);
      for (const vinculo of vinculos) if (vinculo.fornecedorMatrizId === where.fornecedorMatrizId && !vinculo.revogadoEm && !where.aplicativoId.notIn.includes(vinculo.aplicativoId)) { vinculo.revogadoEm = data.revogadoEm; versao++; }
    } },
    fornecedor: {findFirst: async () => ativa ? {id:id(50)} : null},
    $queryRaw: async (consulta: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]) => {
      const sql = "text" in consulta ? consulta : Prisma.sql(consulta, ...valores);
      if (revogarNoLock) { permitido = false; revogarNoLock = false; }
      if (sql.text.includes("vinculos_olist_versao")) return [{vinculosOlistVersao:versao}];
      if (sql.text.includes("FROM aplicativo")) {
        assert.match(sql.text,/id<>[\s\S]*aplicativo_pai_id IS DISTINCT FROM/,"contas nativas ficam fora da confirmação externa");
        assert.match(sql.text,/NOT EXISTS[\s\S]*origem_aplicativo_id IS NULL/,"não converte vínculo interno já existente");
        const quantidadeIds = sql.text.match(/WHERE id IN \(([\s\S]*?)\)/)?.[1].match(/\$\d+/g)?.length ?? 0;
        return sql.values.slice(0, quantidadeIds).map(String).filter(v => [matriz,filho].includes(v)).map(id => ({id}));
      }
      return [{id:admin},{id:alvo}];
    },
    $executeRaw: async (consulta: TemplateStringsArray, ...valores: unknown[]) => {
      const sql=Prisma.sql(consulta,...valores);
      assert.ok(sql.text.includes("origem_aplicativo_id"));
      const [usuarioId, clienteId, matrizId, operadorId, json] = valores;
      assert.equal(usuarioId,alvo); assert.equal(clienteId,cliente); assert.equal(matrizId,matriz); assert.equal(operadorId,admin);
      for (const entrada of JSON.parse(String(json)) as Array<{aplicativoId:string;vendedorOlistId:number}>) {
        const vinculo=vinculos.find(v=>v.aplicativoId===entrada.aplicativoId)!;
        vinculo.vendedorOlistId=entrada.vendedorOlistId;vinculo.confirmadoEm=new Date();vinculo.revogadoEm=null;versao++;
      }
    },
    aplicativo: { findMany: async (consulta: {where:unknown}) => {
      assert.deepEqual(consulta.where,contasExternas,"opções excluem a conta do cliente e seus filhos");
      return [{ id: matriz, nome: "MV" }, { id: filho, nome: "Filial" }];
    } },
  };
  Object.assign(fake, {$transaction: async <T,>(operar:(tx:typeof fake)=>Promise<T>)=>operar(fake)});
  Object.assign(globalThis, { prisma: fake });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: admin, email: "admin@example.test" } }, error: null }));
  const { GET, PATCH } = await import("../src/app/api/usuarios/clientes/route");
  const request = (query = "", payload?: unknown) => new Request(`https://example.test/api/usuarios/clientes${query}`, {
    method: payload ? "PATCH" : "GET", headers: { Authorization: "Bearer fake" }, ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  assert.equal((await GET(new Request("https://example.test/api/usuarios/clientes"))).status, 401);
  permitido = false; assert.equal((await GET(request())).status, 403); permitido = true;
  filialAdmin = true; assert.equal((await GET(request())).status, 403); filialAdmin = false;
  const lista = await GET(request("?pagina=2&limite=500"));
  assert.equal(lista.status, 200); assert.equal(lista.headers.get("cache-control"), "private, no-store");
  const consulta = chamadas.find(c => c.recurso === "usuario.findMany")!.consulta;
  assert.equal(consulta.skip, 100); assert.equal(consulta.take, 100);
  assert.deepEqual(consulta.orderBy, [{ nome: "asc" }, { id: "asc" }]);
  assert.deepEqual((await lista.json()).usuarios, [{ id: alvo, nome: pessoa.nome, aplicativo: pessoa.aplicativo }]);
  assert.equal(chamadas.some(c => c.recurso === "vinculo.findMany"), false, "lista não carrega vínculos nem permissões");
  const detalhe = await GET(request(`?usuarioId=${alvo}`));
  assert.equal(detalhe.status, 200);
  const dados = await detalhe.json();
  assert.equal(dados.usuario.vinculosOlistVersao, 8);
  assert.deepEqual(dados.aplicativos.map((v:{id:string})=>v.id),[matriz,filho],"matriz e irmãs continuam disponíveis para cliente filial, sem oferecer sua própria conta");
  assert.deepEqual(dados.usuario.vendedoresOlist.map((v: {confirmado:boolean}) => v.confirmado), [true, false]);
  assert.equal(dados.usuario.email, undefined); assert.equal(dados.usuario.ativo, undefined);
  assert.equal((await GET(request("?pagina=-1"))).status, 400);
  for (const proibido of [{ profile: { nome: "Adulterado" } }, { permission: "podeEditarConfiguracao", value: true }, { ativo: false }]) {
    assert.equal((await PATCH(request("", { usuarioId: alvo, vinculosOlistVersao: 8, vendedoresOlist: [], ...proibido }))).status, 400);
  }
  const payload = {usuarioId:alvo,vinculosOlistVersao:versao,vendedoresOlist:[{aplicativoId:filho,vendedorOlistId:654}]};
  assert.equal((await PATCH(request("", {...payload,vinculosOlistVersao:0}))).status,409);
  assert.equal((await PATCH(request("", {...payload,vendedoresOlist:[{aplicativoId:id(99),vendedorOlistId:10}]}))).status,400);
  assert.equal((await PATCH(request("", {...payload,vendedoresOlist:[{aplicativoId:cliente,vendedorOlistId:999}]}))).status,400,"não permite sobrepor vendedor nativo do cliente");
  const salva=await PATCH(request("",payload));
  assert.equal(salva.status,200);
  const respostaSalva=await salva.json();
  assert.ok(respostaSalva.usuario.vinculosOlistVersao>8);
  assert.equal(vinculos.find(v=>v.aplicativoId===matriz)?.revogadoEm instanceof Date,true);
  assert.equal(vinculos.find(v=>v.aplicativoId===filho)?.vendedorOlistId,654);
  assert.equal(vinculos.find(v=>v.aplicativoId===filho)?.revogadoEm,null);
  assert.equal(vinculos.find(v=>v.aplicativoId===id(99))?.revogadoEm,null,"outro fornecedor preservado");
  assert.doesNotMatch(JSON.stringify(respostaSalva),/999/);
  revogarNoLock=true;
  assert.equal((await PATCH(request("",{...payload,vinculosOlistVersao:versao}))).status,403);
  permitido=true;
  ativa = false;
  assert.equal((await GET(request(`?usuarioId=${alvo}`))).status, 404);
  assert.equal((await PATCH(request("", { usuarioId: alvo, vinculosOlistVersao: 8, vendedoresOlist: [] }))).status, 404);
});
