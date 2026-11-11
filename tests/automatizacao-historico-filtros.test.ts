import assert from "node:assert/strict";
import { test } from "node:test";

test("histórico filtra pela habilidade executada, combina rotina e mantém isolamento e paginação", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia";
  const habilidadeId = "11111111-1111-4111-8111-111111111111";
  const rotinaId = "22222222-2222-4222-8222-222222222222";
  let permitido = true;
  let consultaExecucao: Record<string, unknown> = {};
  let consultaDisparo: Record<string, unknown> = {};
  let chamadasExecucao = 0;
  let chamadasDisparo = 0;
  let quantidade = 1;
  Object.assign(globalThis, { prisma: {
    usuario: { findUnique: async () => ({ ativo: true, podeVisualizarAutomatizacao: permitido, aplicativoId: "app-atual" }) },
    execucaoAutomatizacao: { findMany: async (consulta: Record<string, unknown>) => {
      chamadasExecucao++; consultaExecucao = consulta;
      return Array.from({ length: quantidade }, (_, id) => ({ id }));
    } },
    disparoAutomatizacao: { findMany: async (consulta: Record<string, unknown>) => {
      chamadasDisparo++; consultaDisparo = consulta;
      return Array.from({ length: 26 }, () => ({ motivo: "FALHA_ANTERIOR" }));
    } },
  } });
  t.after(() => { Reflect.deleteProperty(globalThis, "prisma"); });
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ error: null, data: { user: { id: "usuario" } } }));
  const { GET } = await import("../src/app/api/automatizacao/[recurso]/route");
  const consultar = (query: string, autenticado = true) => GET(new Request(`https://erp.test/api/automatizacao/historico?${query}`, {
    headers: autenticado ? { Authorization: "Bearer token-ficticio" } : {},
  }), { params: Promise.resolve({ recurso: "historico" }) });

  let resposta = await consultar(`habilidadeId=${habilidadeId}&rotinaId=${rotinaId}&pagina=1&status=FALHA_FINAL`);
  assert.equal(resposta.status, 200);
  assert.deepEqual(consultaExecucao.where, {
    aplicativoId: "app-atual", rotinaId, versao: { habilidadeId }, status: "FALHA_FINAL", tipo: undefined,
    previstoEm: undefined, tentativas: undefined,
  });
  assert.equal(consultaExecucao.skip, 25);
  assert.equal(consultaExecucao.take, 26);
  assert.equal(chamadasDisparo, 0);
  assert.deepEqual(await resposta.json(), { execucoes: [{ id: 0 }], disparos: [], temMais: false });
  quantidade = 26;
  resposta = await consultar(`habilidadeId=${habilidadeId}`);
  const dados = await resposta.json();
  assert.equal(dados.execucoes.length, 25);
  assert.equal(dados.temMais, true);

  quantidade = 1;
  resposta = await consultar(`rotinaId=${rotinaId}`);
  assert.equal((consultaExecucao.where as { versao?: unknown }).versao, undefined);
  assert.deepEqual(consultaDisparo.where, { aplicativoId: "app-atual", rotinaId, previstoEm: undefined, motivo: { not: "ENFILEIRADO" } });
  assert.equal((await resposta.json()).disparos.length, 25);

  const anteriores = chamadasExecucao;
  assert.equal((await consultar("habilidadeId=invalido")).status, 400);
  assert.equal((await consultar("", false)).status, 401);
  permitido = false;
  assert.equal((await consultar(`habilidadeId=${habilidadeId}`)).status, 403);
  assert.equal(chamadasExecucao, anteriores);
});
