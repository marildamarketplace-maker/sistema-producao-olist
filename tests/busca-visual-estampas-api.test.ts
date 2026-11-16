import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { criarConsultaFoto } from "../src/lib/estampas-visuais/consulta-foto";

test("busca por foto preserva permissões, pagina atributos e mantém filtros obrigatórios", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  process.env.ESTAMPAS_BUSCA_VISUAL_HABILITADA = "true";
  let permitido = true, falha = false, chamadas = 0;
  const sqls: Prisma.Sql[] = [];
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario" }), findUnique: async () => ({ podeVisualizarEstampas: permitido }) },
    $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => {
      if (falha) throw new Error("credencial-privada");
      const sql = Prisma.sql(s, ...v); sqls.push(sql);
      return sql.sql.includes("COUNT(*)::BIGINT AS total") ? [{ total: BigInt(2), completas: BigInt(0), parciais: BigInt(2) }] : [];
    },
  } });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario", email: "teste@example.test" } }, error: null }));
  t.mock.method(globalThis, "fetch", async () => { chamadas++; throw new Error("Não deve analisar novamente"); });
  const { GET, POST } = await import("../src/app/api/estampas/pesquisa-imagem/route");
  const referencia = { motivos: ["flores"], cores: ["azul"], tema: "floral", estilo: "", distribuicao: "", linguagemVisual: "" };
  const token = criarConsultaFoto("usuario", referencia);
  const request = (consultaId = token) => {
    const body = new FormData(); body.set("consultaId", consultaId);
    body.set("parametros", "pagina=2&porPagina=1&cor=verde&preferencias=cores&q=flor");
    return new Request("http://localhost", { method: "POST", headers: { Authorization: "Bearer teste" }, body });
  };
  assert.equal((await GET(new Request("http://localhost"))).status, 401);
  permitido = false; assert.equal((await POST(request())).status, 403); permitido = true;
  const resposta = await POST(request()); assert.equal(resposta.status, 200);
  const dados = await resposta.json(); assert.equal(dados.pagina, 2); assert.equal(dados.ordenacao, "RELEVANCIA");
  assert.ok(dados.imagem.criterios.includes("Foto · motivo: flores"));
  assert.equal(chamadas, 0);
  const sql = sqls.find(s => s.sql.includes("WITH pagina"))!;
  assert.match(sql.sql, /e.cores @>/); assert.ok(sql.values.includes("verde"));
  assert.match(sql.sql, /aderencia.percentual DESC/); assert.match(sql.sql, /OFFSET/);
  assert.doesNotMatch(sql.sql, /embeddings|consultas_visuais/);
  assert.equal((await POST(request(criarConsultaFoto("outro", referencia)))).status, 410);
  assert.equal((await POST(request(criarConsultaFoto("usuario", referencia, 0)))).status, 410);
  process.env.ESTAMPAS_BUSCA_VISUAL_HABILITADA = "false"; assert.equal((await POST(request())).status, 503);
  process.env.ESTAMPAS_BUSCA_VISUAL_HABILITADA = "true";
  falha = true; const erro = await POST(request()); assert.equal(erro.status, 503); assert.doesNotMatch(await erro.text(), /credencial/);
});
