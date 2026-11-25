import assert from "node:assert/strict";
import test from "node:test";
import { avaliarDirecionamentoPedido, classificarDocumentoDirecionamento, configuracaoDirecionamentoSchema, type ConfiguracaoDirecionamento, type RegraDirecionamento } from "../src/lib/direcionamento-pedidos-contrato";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const regra = (n: number, condicoes: RegraDirecionamento["condicoes"], combinacao: "E" | "OU" = "E"): RegraDirecionamento => ({ id: id(n), nome: `Regra ${n}`, ativa: true, aplicativoId: id(n + 10), combinacao, condicoes });
const config = (regras: RegraDirecionamento[]): ConfiguracaoDirecionamento => ({ versao: 3, aplicativoPadraoId: id(99), regras });
const cliente = { nome: "Loja Marketplace", cpfCnpj: "529.982.247-25", uf: "SP" };
test("primeira regra ativa vence; reordenação altera prioridade", () => {
  const fora = regra(1, [{ campo: "UF_FORA", ufs: ["MG"] }]);
  const cpf = regra(2, [{ campo: "DOCUMENTO_TIPO", tipo: "CPF" }]);
  assert.equal(avaliarDirecionamentoPedido(config([fora, cpf]), cliente).aplicativoId, fora.aplicativoId);
  assert.equal(avaliarDirecionamentoPedido(config([cpf, fora]), cliente).aplicativoId, cpf.aplicativoId);
  assert.equal(avaliarDirecionamentoPedido(config([{ ...fora, ativa: false }, cpf]), cliente).regraId, cpf.id);
});
test("E/OU, nome Unicode e espaços, UF normalizada e ausência legítima", () => {
  const condicoes: RegraDirecionamento["condicoes"] = [{ campo: "UF_EM", ufs: ["MG"] }, { campo: "NOME_CONTEM", texto: "ＭＡＲＫＥＴＰＬＡＣＥ" }];
  assert.equal(avaliarDirecionamentoPedido(config([regra(1, condicoes)]), cliente).tipo, "PADRAO");
  assert.equal(avaliarDirecionamentoPedido(config([regra(1, condicoes, "OU")]), cliente).tipo, "REGRA");
  assert.equal(avaliarDirecionamentoPedido(config([regra(1, condicoes)]), { ...cliente, uf: " mg " }).tipo, "REGRA");
  for (const uf of [null, "", "XX"]) assert.equal(avaliarDirecionamentoPedido(config([regra(1, [{ campo: "UF_FORA", ufs: ["MG"] }])]), { ...cliente, uf }).tipo, "PADRAO");
  assert.equal(avaliarDirecionamentoPedido(config([regra(1, [{ campo: "NOME_CONTEM", texto: "Loja   Marketplace" }])]), cliente).tipo, "REGRA");
});
test("classificação fiscal separada valida dígitos, pontuação e CNPJ alfanumérico", () => {
  assert.equal(classificarDocumentoDirecionamento(cliente.cpfCnpj), "CPF");
  assert.equal(classificarDocumentoDirecionamento("11.222.333/0001-81"), "CNPJ");
  assert.equal(classificarDocumentoDirecionamento("12.ABC.345/01DE-35"), "CNPJ");
  for (const doc of [null, "", "00000000000", "52998224724", "11.222.333/0001-82", "CPF"]) assert.equal(classificarDocumentoDirecionamento(doc), null);
});
test("padrão sem regras ativas e contratos estritos/limitados", () => {
  assert.equal(avaliarDirecionamentoPedido(config([]), cliente).aplicativoId, id(99));
  const r = regra(1, [{ campo: "UF_EM", ufs: ["MG"] }]);
  for (const entrada of [
    { ...config([]), regras: [{ ...r, condicoes: [] }] }, { ...config([]), regras: [r, r] },
    { ...config([]), regras: [{ ...r, condicoes: [{ campo: "UF_EM", ufs: ["XX"] }] }] },
    { ...config([]), regras: [{ ...r, condicoes: [{ campo: "NOME_CONTEM", texto: " " }] }] },
    { ...config([]), regras: [{ ...r, script: "alert(1)" }] }, { ...config([]), aplicativoPaiId: id(7) },
    { ...config([]), regras: Array.from({ length: 51 }, (_, i) => ({ ...r, id: id(i + 1) })) },
  ]) assert.equal(configuracaoDirecionamentoSchema.safeParse(entrada).success, false);
});

test("configuração/API isolam pai, destinos e concorrência e congelam versão no aceite", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
  const usuario = { id: id(1), aplicativoId: id(2), ativo: true, podeVisualizarConfiguracao: true, podeEditarConfiguracao: true, aplicativo: { aplicativoPaiId: null as string | null } };
  let filhos = [{ id: id(3), nome: "Filho" }];
  let atual: ConfiguracaoDirecionamento | null = null;
  const locks: string[] = [];
  const tx = {
    usuario: { findFirst: async () => usuario, findUnique: async () => usuario },
    aplicativo: { findMany: async () => filhos, findFirst: async () => filhos[0] ?? null },
    direcionamentoPedidos: { findUnique: async () => atual, upsert: async ({ create, update }: { create: ConfiguracaoDirecionamento; update: ConfiguracaoDirecionamento }) => { const v = atual ? update : create; atual = { versao: v.versao, regras: v.regras, aplicativoPadraoId: v.aplicativoPadraoId }; return atual; } },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?"); locks.push(sql);
      if (sql.includes("FROM direcionamento_pedidos")) return atual ? [{ versao: atual.versao, aplicativoPadraoId: atual.aplicativoPadraoId }] : [];
      if (sql.includes("id::text IN")) {
        const partes = values.flatMap(v => v && typeof v === "object" && "values" in v && Array.isArray(v.values) ? v.values : [v]);
        return filhos.filter(f => partes.includes(f.id));
      }
      if (sql.includes("aplicativo_pai_id=")) return filhos.filter(f => f.id === values[0]);
      return [{ id: usuario.aplicativoId, aplicativoPaiId: usuario.aplicativo.aplicativoPaiId }];
    },
  };
  Object.assign(globalThis, { prisma: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: usuario.id, email: "test@example.test" } }, error: null }));
  const { GET, PUT } = await import("../src/app/api/olist/direcionamento/route");
  const service = await import("../src/lib/direcionamento-pedidos");
  const req = (body?: unknown) => new Request("https://example.test/api/olist/direcionamento", { headers: { Authorization: "Bearer fake" }, ...(body ? { method: "PUT", body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(new Request("https://example.test"))).status, 401);
  usuario.podeVisualizarConfiguracao = false; usuario.podeEditarConfiguracao = false;
  assert.equal((await GET(req())).status, 403);
  usuario.podeVisualizarConfiguracao = true;
  assert.equal((await PUT(req(config([])))).status, 403);
  usuario.podeEditarConfiguracao = true;
  const entrada = { versao: 0, regras: [], aplicativoPadraoId: id(3) };
  assert.equal((await PUT(req({ ...entrada, aplicativoPadraoId: id(9) }))).status, 400);
  assert.equal((await PUT(req(entrada))).status, 200);
  assert.equal((await PUT(req(entrada))).status, 409);
  const decisao = await service.resolverDirecionamentoPedido(id(2), cliente);
  assert.equal(decisao.tipo, "PADRAO");
  // Mock delimitado da fronteira transacional; os locks são verificados abaixo.
  const client = tx as unknown as import("@prisma/client").Prisma.TransactionClient;
  await service.validarVersaoDirecionamento(client, id(2), decisao);
  await assert.rejects(service.validarVersaoDirecionamento(client, id(2), { ...decisao, versao: 0 }), /Regras alteradas/);
  assert.ok(locks.some(s => /FOR UPDATE/.test(s)));
  assert.ok(locks.some(s => /direcionamento_pedidos.*FOR SHARE/.test(s)));
  usuario.aplicativo.aplicativoPaiId = id(8);
  assert.equal((await GET(req())).status, 200);
  assert.deepEqual(await (await GET(req())).json(), { disponivel: false });
  assert.equal((await PUT(req(entrada))).status, 403);
  usuario.aplicativo.aplicativoPaiId = null;
  atual = null;
  await assert.rejects(service.resolverDirecionamentoPedido(id(2), cliente), /Configure o aplicativo padrão/);
  atual = { ...entrada, versao: 1, aplicativoPadraoId: id(99) };
  await assert.rejects(service.resolverDirecionamentoPedido(id(2), cliente), /indisponível/);
  filhos = [];
  assert.equal((await service.resolverDirecionamentoPedido(id(2), cliente)).tipo, "CONTA_UNICA");
});
