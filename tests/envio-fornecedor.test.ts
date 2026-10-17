import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

// Banco simulado com serialização transacional e rollback, sem rede ou credenciais reais.
test("reserva compartilhada, resultados e falhas de persistência", async (t) => {
  let estado: Record<string, any> | null = null;
  let registros: any[] = [];
  let status = "PENDENTE", versao = 0, posts = 0, filialValida = true, persistenciaFalha = false;
  let resposta: unknown = { id: 123 };
  let http = 200, timeout = false;
  const tx: any = {
    $queryRaw: async (sql: TemplateStringsArray) => sql.join("").includes("FROM aplicativo") ? filialValida ? [{ id: "filial" }] : [] : [{ id: "solicitacao" }],
    pedidoFornecedorSolicitacao: {
      findFirst: async () => registros[0] ?? null,
      create: async ({ data }: any) => { if (persistenciaFalha) throw new Error("banco indisponível segredo"); const r = { ...data, id: "registro" }; registros.push(r); return r; },
    },
    envioFornecedor: {
      findUnique: async () => estado,
      upsert: async ({ create, update }: any) => { estado = { ...(estado ?? create), ...update }; return estado; },
      update: async ({ where, data }: any) => { assert.equal(where.tentativaId, estado?.tentativaId); estado = { ...estado, ...data }; return estado; },
      updateMany: async ({ where, data }: any) => { if (where.tentativaId !== estado?.tentativaId || where.estado !== estado?.estado) return { count: 0 }; estado = { ...estado, ...data }; return { count: 1 }; },
    },
    pedidoFornecedorQueue: {
      findUnique: async () => ({ status }),
      updateMany: async ({ where, data }: any) => {
        if (where.versao !== undefined && (where.versao !== versao || !where.status.in.includes(status))) return { count: 0 };
        if (where.status?.not && status === where.status.not) return { count: 0 };
        status = data.status; versao++; return { count: 1 };
      },
    },
  };
  let fila = Promise.resolve();
  const banco = { ...tx,
    aplicativo: { findUnique: async () => ({ id: "filial", nome: "Filial", olistClientId: "fake", olistClientSecret: "fake" }) },
    integracaoOlistToken: { findUnique: async () => ({ accessToken: "fake", expiresAt: new Date(Date.now() + 3600_000) }) },
    $transaction: async (fn: (tx: any) => unknown) => {
      const anterior = fila; let liberar!: () => void; fila = new Promise((r) => { liberar = r; }); await anterior;
      const antes = structuredClone({ estado, registros, status, versao });
      try { return await fn(tx); } catch (e) { ({ estado, registros, status, versao } = antes); throw e; } finally { liberar(); }
    },
  };
  Object.assign(globalThis, { prisma: banco });
  t.mock.method(axios, "post", async () => { posts++; if (timeout) throw new Error("ETIMEDOUT token-secreto"); return { status: http, data: resposta }; });
  const { enviarFornecedor, envioExpirado } = await import("../src/lib/envio-fornecedor");
  const base = { solicitacaoId: "solicitacao", fornecedorId: "fornecedor", aplicativoId: "filial", usuarioId: "usuario", payload: { observacoesInternas: "Revisado", itens: [] } };
  const enviar = (direto = false) => enviarFornecedor({ ...base, ...(direto ? {} : { fila: { id: "fila", versao, matrizId: "matriz" } }) });
  const reset = () => { estado = null; registros = []; status = "PENDENTE"; versao = 0; posts = 0; http = 200; timeout = false; resposta = { id: 123 }; persistenciaFalha = false; filialValida = true; };
  await t.test("duplo clique e corrida entre envio direto e fila fazem apenas um POST", async () => {
    reset(); const resultados = await Promise.allSettled([enviar(), enviar(true), enviar()]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(posts, 1); assert.equal(status, "CONCLUIDO"); assert.equal(estado?.estado, "CONCLUIDO");
    assert.equal(registros[0].aplicativoDestinatarioId, "filial"); assert.equal(registros[0].pedidoOlistId, "123");
    assert.match(String(estado?.payload.observacoesInternas), /Solicitacao fornecedor: solicitacao/);
    await assert.rejects(enviar()); assert.equal(posts, 1);
  });
  await t.test("filial inválida e versão concorrente não fazem chamada externa", async () => {
    reset(); filialValida = false; await assert.rejects(enviar()); assert.equal(posts, 0); assert.equal(estado, null);
    filialValida = true; await assert.rejects(enviarFornecedor({ ...base, fila: { id: "fila", versao: 999, matrizId: "matriz" } })); assert.equal(posts, 0);
  });
  await t.test("rejeição conhecida registra FALHADO e permite tentativa manual corrigida", async () => {
    reset(); http = 422; resposta = { error: "dados sensíveis" }; await assert.rejects(enviar(), /HTTP 422/);
    assert.equal(estado?.estado, "REJEITADO"); assert.equal(status, "FALHADO"); assert.equal(registros.length, 0);
    http = 200; resposta = { id: 321 }; await enviar(); assert.equal(posts, 2); assert.equal(estado?.historico.filter((e: any) => e.acao === "RESERVA").length, 2);
  });
  for (const cenario of ["timeout", "sem ID", "ID zero", "ID inválido", "HTTP 500", "persistência interrompida"]) await t.test(`${cenario} fica incerto e bloqueia repetição`, async () => {
    reset(); timeout = cenario === "timeout"; if (cenario === "sem ID") resposta = {}; if (cenario === "ID zero") resposta = { id: 0 }; if (cenario === "ID inválido") resposta = { id: "abc" }; if (cenario === "HTTP 500") http = 500; persistenciaFalha = cenario === "persistência interrompida";
    await assert.rejects(enviar(), (e: Error) => /incerto/.test(e.message) && !/segredo|token-secreto/.test(e.message));
    assert.equal(estado?.estado, "INCERTO"); assert.equal(status, "FALHADO"); assert.equal(registros.length, 0);
    assert.ok(estado?.chamadaEm instanceof Date); await assert.rejects(enviar()); await assert.rejects(enviar(true)); assert.equal(posts, 1);
    if (persistenciaFalha) assert.equal(estado?.pedidoOlistId, "123");
    else assert.equal(estado?.pedidoOlistId, null);
  });
  await t.test("401 não causa retry automático do POST", async () => { reset(); http = 401; await assert.rejects(enviar()); assert.equal(posts, 1); });
  await t.test("reserva sem conclusão é bloqueada; expiração só permite conferência manual", async () => {
    reset(); estado = { ...base, estado: "RESERVADO", iniciadoEm: new Date(0), historico: [] };
    await assert.rejects(enviar()); assert.equal(posts, 0); assert.equal(envioExpirado(estado.iniciadoEm), true);
    assert.equal(envioExpirado(new Date()), false);
  });
});
