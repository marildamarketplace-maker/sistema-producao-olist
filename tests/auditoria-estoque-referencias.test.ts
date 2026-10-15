import assert from "node:assert/strict";
import test from "node:test";
import { auditarEstoqueReferencias, criarMensagensAuditoria, lerEstoqueReferencia, type DependenciasAuditoria } from "../src/lib/auditoria-estoque-referencias";
import { prepararNotificationsAuditoria } from "../src/lib/auditoria-estoque-notifications";
import { aplicativoTemJob, CHAVES_JOB } from "../src/lib/aplicativo-jobs";

const data = new Date("2026-10-15T12:00:00Z");
function dependencias(nomes: string[], saldos: (string | number)[], unidades = nomes.map(() => "MT")): DependenciasAuditoria {
  return {
    listar: async (_app, { offset }) => ({
      itens: offset === 0 ? nomes.map((descricao, i) => ({ id: String(i + 1), descricao })) : [],
      paginacao: { offset, limit: 100, total: nomes.length },
    }),
    obterEstoque: async (_app, id) => ({ id, unidade: unidades[Number(id) - 1], saldo: saldos[Number(id) - 1], reservado: 900, disponivel: -900 }),
  };
}

test("soma base e todos os lotes do print usando saldo físico", async () => {
  const nomes = ["Ref. 5168", ...[2, 3, 4, 5, 6, 7].map((n) => `Ref. 5168 - LOTE ${n}`), "Ref. 6607", "Ref. 6607 - LOTE 2", "Ref. 6607 - LOTE 3", "Ref. 6607 - LOTE 4", "Ref. 6607 - LOTE 5"];
  const grupos = await auditarEstoqueReferencias("app", dependencias(nomes, [39.65, -5.95, -15.1, -281.4, -1.4, 0, -2.1, 147.6, -89.2, 11.2, -21.8, -3]));
  assert.deepEqual(grupos.map((g) => g.saldo), ["-266.3", "44.8"]);
  const mensagens = criarMensagensAuditoria(grupos, data);
  assert.match(mensagens[0], /-266,30 MT/);
  assert.doesNotMatch(mensagens.join(""), /6607/);
  assert.match(mensagens[0], /LOTE 7/);
});

test("decimais não produzem falsos negativos e zero não gera alerta", async () => {
  const grupos = await auditarEstoqueReferencias("app", dependencias(["Ref 1", "Ref 1 - LOTE 2", "Ref 1 - LOTE 3"], ["0.1", "0.2", "-0.3"]));
  assert.equal(grupos[0].saldo, "0");
  assert.deepEqual(criarMensagensAuditoria(grupos, data), []);
});

test("preserva material, referência completa, unidade e sufixos que não são lotes", async () => {
  const grupos = await auditarEstoqueReferencias("app", dependencias(["Oxford Ref 123 ABC", "Tricoline Ref 123 ABC", "Oxford Ref 123 DEF", "Oxford Ref 123 ABC - LOTE 2", "Oxford Ref 123 ABC - LOTE X", "Oxford Ref 123 ABC"], [-1, -2, -3, -4, -5, -6], ["MT", "MT", "MT", "MT", "MT", "KG"]));
  assert.equal(grupos.length, 5);
  assert.equal(grupos.find((g) => g.produtoBase === "Oxford Ref 123 ABC" && g.unidade === "MT")?.saldo, "-5");
});

test("continua paginação mesmo com total sintetizado e páginas pequenas", async () => {
  const offsets: number[] = [];
  const apps: string[] = [];
  const deps = dependencias([], []);
  deps.listar = async (app, { offset }) => {
    apps.push(app); offsets.push(offset);
    return { itens: offset < 2 ? [{ id: offset + 1, descricao: `Ref 1${offset ? " - LOTE 2" : ""}` }] : [], paginacao: { offset, limit: 100, total: 1 } };
  };
  deps.obterEstoque = async (app, id) => { apps.push(app); return { id, unidade: "MT", saldo: -1 }; };
  assert.equal((await auditarEstoqueReferencias("tenant-a", deps))[0].saldo, "-2");
  assert.deepEqual(offsets, [0, 1, 2]);
  assert.ok(apps.every((app) => app === "tenant-a"));
});

test("falha fechada em saldo inválido, identificação divergente e unidade ausente", () => {
  for (const saldo of [null, undefined, "", " ", NaN, Infinity, "1,2", true, {}, "1e3"]) {
    assert.throws(() => lerEstoqueReferencia({ id: 1, unidade: "MT", saldo }, "1"));
  }
  assert.throws(() => lerEstoqueReferencia({ id: 2, unidade: "MT", saldo: 1 }, "1"));
  assert.throws(() => lerEstoqueReferencia({ id: 1, saldo: 1 }, "1"));
});

test("erro em lote ou página impede retorno parcial", async () => {
  const deps = dependencias(["Ref 1", "Ref 1 - LOTE 2"], [-1, -2]);
  deps.obterEstoque = async (_app, id) => { if (id === "2") throw new Error("429"); return { id, unidade: "MT", saldo: -1 }; };
  await assert.rejects(auditarEstoqueReferencias("app", deps), /429/);
  deps.listar = async () => { throw new Error("página indisponível"); };
  await assert.rejects(auditarEstoqueReferencias("app", deps), /página/);
});

test("detecta páginas repetidas e prazo excedido", async () => {
  const deps = dependencias(["Ref 1"], [-1]);
  deps.listar = async () => ({ itens: [{ id: 1, descricao: "Ref 1" }], paginacao: { limit: 100, offset: 0, total: 1 } });
  await assert.rejects(auditarEstoqueReferencias("app", deps), /repetido/);
  await assert.rejects(auditarEstoqueReferencias("app", deps, 0), /Prazo/);
});

test("mensagens grandes são divididas sem omitir lotes", () => {
  const grupos = Array.from({ length: 120 }, (_, i) => ({ produtoBase: `Oxford Ref ${i}`, unidade: "MT", saldo: "-1", lotes: [{ id: String(i), nome: `Oxford Ref ${i} - LOTE 2`, saldo: "-1" }] }));
  const mensagens = criarMensagensAuditoria(grupos, data);
  assert.ok(mensagens.length > 1);
  assert.ok(mensagens.every((m) => m.length <= 3_400));
  for (let i = 0; i < 120; i++) assert.ok(mensagens.join("\n").includes(`[ID ${i}]`));
});

test("enqueue deduplica por aplicativo/destinatário/dia/relatório e mantém status pendente", () => {
  const input = { aplicativoId: "app-a", whatsapp: "+55 (11) 99999-0000,5511999990000,5511999990001", mensagens: ["parte 1", "parte 2"], executadoEm: data };
  const dados = prepararNotificationsAuditoria(input);
  assert.equal(dados.length, 4);
  assert.equal(new Set(dados.map((d) => d.id)).size, 4);
  assert.ok(dados.every((d) => d.status === "PENDENTE" && d.tipo === "WHATSAPP"));
  assert.deepEqual(dados.map((d) => d.id), prepararNotificationsAuditoria({ ...input, executadoEm: new Date("2026-10-16T01:00:00Z") }).map((d) => d.id));
  for (const mudanca of [{ aplicativoId: "app-b" }, { mensagens: ["mudou"] }, { executadoEm: new Date("2026-10-16T12:00:00Z") }]) {
    assert.notEqual(dados[0].id, prepararNotificationsAuditoria({ ...input, ...mudanca })[0].id);
  }
  assert.throws(() => prepararNotificationsAuditoria({ ...input, whatsapp: "inválido" }));
});

test("auditoria requer habilitação explícita independente do validador", () => {
  assert.equal(aplicativoTemJob("VALIDADOR_ESTOQUE,NOTIFICAR", CHAVES_JOB.AUDITORIA_ESTOQUE_REFERENCIAS), false);
  assert.equal(aplicativoTemJob("auditoria_estoque_referencias,NOTIFICAR", CHAVES_JOB.AUDITORIA_ESTOQUE_REFERENCIAS), true);
});
