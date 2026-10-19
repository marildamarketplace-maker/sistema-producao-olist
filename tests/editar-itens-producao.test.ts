import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { editarItensProducao, normalizarEdicaoItensProducao } from "../src/lib/editar-itens-producao";
import { revisaoItensProducao, type ItemRevisaoProducao } from "../src/lib/producao-revisao";
import { calcularAjustesEstoqueProducao, saldoMovimentacoesProducao } from "../src/lib/producao-ajustes-estoque";

const pedido = "00000000-0000-0000-0000-000000000001";
const app = "00000000-0000-0000-0000-000000000002";
const produtoA = "00000000-0000-0000-0000-000000000003";
const produtoB = "00000000-0000-0000-0000-000000000004";
const itemId = "00000000-0000-0000-0000-000000000005";
const item = (): ItemRevisaoProducao => ({ id: itemId, produtoId: produtoA, sku: "SKU-A", imagemUrl: null, quantidadeSolicitada: 50, quantidadeProduzida: 50, tipoCorte: "LASER", observacao: "Preservar observação" });
const edicao = (quantidadeProduzida = 40) => ({ id: itemId, produtoId: produtoA, quantidadeSolicitada: 50, quantidadeProduzida });

test("valida itens, quantidades inteiras, versão e duplicidade antes de salvar", () => {
  const revisao = revisaoItensProducao("concluida", [item()]);
  assert.equal(normalizarEdicaoItensProducao({ revisao, itens: [edicao(0)] }).itens[0].quantidadeProduzida, 0);
  for (const itens of [[], Array(501).fill(edicao()), [edicao(-1)], [edicao(1.5)], [edicao(Infinity)], [edicao(2147483648)], [{ ...edicao(), quantidadeProduzida: "5" }], [{ ...edicao(), produtoId: "invalido" }], [edicao(), edicao()]]) {
    assert.throws(() => normalizarEdicaoItensProducao({ revisao, itens }));
  }
  assert.throws(() => normalizarEdicaoItensProducao({ revisao: "desatualizada", itens: [edicao()] }));
});

test("saldo considera entradas e correções e divide movimentos maiores que Int", () => {
  const atual = saldoMovimentacoesProducao([{ produtoId: produtoA, sku: "SKU-A", tipoMovimento: "entrada", quantidade: 50 }, { produtoId: produtoA, sku: "SKU-A", tipoMovimento: "saida", quantidade: 10 }]);
  assert.deepEqual(calcularAjustesEstoqueProducao(atual, [{ produtoId: produtoA, sku: "SKU-A", quantidade: 45 }]), [{ produtoId: produtoA, sku: "SKU-A", tipoMovimento: "entrada", quantidade: 5 }]);
  const grande = calcularAjustesEstoqueProducao([], [{ produtoId: produtoA, sku: "SKU-A", quantidade: 2147483650 }]);
  assert.deepEqual(grande.map((mov) => mov.quantidade), [2147483647, 3]);
});

test("edições em todos os status são atômicas e ajustam somente o saldo de concluídas", async (t) => {
  type Movimento = { produtoId: string; sku: string; tipoMovimento: string; quantidade: number; origem: string; referenciaId: string; aplicativoId: string; observacao?: string };
  let estado: { status: string; itens: ItemRevisaoProducao[]; movimentos: Movimento[] };
  let falharEscrita = false;
  let produtoDisponivel = true;
  let conflitoBanco = false;
  const reiniciar = (status = "concluida") => {
    estado = { status, itens: [item()], movimentos: status === "concluida" ? [{ produtoId: produtoA, sku: "SKU-A", tipoMovimento: "entrada", quantidade: 50, origem: "PRODUCAO", referenciaId: pedido, aplicativoId: app }] : [] };
  };
  Object.assign(globalThis, { prisma: {
    usuario: { findFirst: async () => ({ id: "usuario-http", aplicativoId: app }), findUnique: async () => ({ podeSolicitarProducao: true }) },
    $transaction: async (executar: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, "Serializable");
      if (conflitoBanco) throw new Prisma.PrismaClientKnownRequestError("Conflito", { code: "P2034", clientVersion: "teste" });
      const rascunho = structuredClone(estado);
      const tx = {
        solicitacaoProducao: { findFirst: async ({ where }: { where: { id: string; aplicativoId: string } }) => {
          assert.equal(where.id, pedido);
          return where.aplicativoId === app ? { id: pedido, status: rascunho.status } : null;
        } },
        itemSolicitacaoProducao: {
          findMany: async ({ where }: { where: { aplicativoId: string; solicitacaoId: string } }) => {
            assert.deepEqual(where, { aplicativoId: app, solicitacaoId: pedido }); return rascunho.itens;
          },
          deleteMany: async ({ where }: { where: { id: { notIn: string[] } } }) => { rascunho.itens = rascunho.itens.filter((item) => where.id.notIn.includes(item.id)); },
          update: async ({ where, data }: { where: { id: string }; data: Partial<ItemRevisaoProducao> }) => {
            if (falharEscrita) throw new Error("Falha ao atualizar item");
            Object.assign(rascunho.itens.find((item) => item.id === where.id)!, data);
          },
          create: async ({ data }: { data: ItemRevisaoProducao & { statusItem: string } }) => {
            assert.equal(data.statusItem, rascunho.status); rascunho.itens.push({ ...data, id: produtoB });
          },
        },
        produto: { findMany: async ({ where }: { where: { aplicativoId: string; ativo: boolean } }) => { assert.equal(where.aplicativoId, app); assert.equal(where.ativo, true); return produtoDisponivel ? [{ id: produtoB, sku: "SKU-B", imagemUrl: null }] : []; } },
        movimentacaoEstoque: {
          findMany: async ({ where }: { where: { aplicativoId: string; referenciaId: string; origem: { in: string[] } } }) => {
            assert.equal(where.aplicativoId, app); assert.equal(where.referenciaId, pedido);
            return rascunho.movimentos.filter((mov) => where.origem.in.includes(mov.origem));
          },
          createMany: async ({ data }: { data: Movimento[] }) => { rascunho.movimentos.push(...data); },
        },
      };
      const resultado = await executar(tx);
      estado = rascunho;
      return resultado;
    },
  } });
  const entrada = (itens: ReturnType<typeof normalizarEdicaoItensProducao>["itens"] = [edicao()], revisao = revisaoItensProducao(estado.status, estado.itens)) => ({ aplicativoId: app, solicitacaoId: pedido, usuarioId: "usuario-teste", revisao, itens });

  await t.test("persiste corte e observação em itens existentes e novos sem alterar estoque", async () => {
    reiniciar();
    await editarItensProducao(entrada([{ ...edicao(50), tipoCorte: null, observacao: "Texto revisado" }, { id: null, produtoId: produtoB, quantidadeSolicitada: 2, quantidadeProduzida: 0, tipoCorte: "LASER", observacao: "Item novo" }]));
    assert.equal(estado.itens[0].tipoCorte, null);
    assert.equal(estado.itens[0].observacao, "Texto revisado");
    assert.equal(estado.itens[1].tipoCorte, "LASER");
    assert.equal(estado.itens[1].observacao, "Item novo");
    assert.equal(estado.movimentos.length, 1);
    await editarItensProducao(entrada([{ ...edicao(50), observacao: null }, { id: estado.itens[1].id, produtoId: produtoB, quantidadeSolicitada: 2, quantidadeProduzida: 0 }]));
    assert.equal(estado.itens[0].observacao, null);
    assert.equal(estado.itens[1].observacao, "Item novo");
  });
  await t.test("50 para 40 gera saída de 10 sem apagar a entrada original", async () => {
    reiniciar(); await editarItensProducao(entrada());
    assert.deepEqual(estado.movimentos.map((mov) => [mov.origem, mov.tipoMovimento, mov.quantidade]), [["PRODUCAO", "entrada", 50], ["AJUSTE_PRODUCAO", "saida", 10]]);
    assert.equal(estado.itens[0].quantidadeProduzida, 40);
    assert.equal(estado.itens[0].observacao, "Preservar observação"); assert.equal(estado.itens[0].tipoCorte, "LASER");
    assert.equal(estado.status, "concluida");
  });
  await t.test("nova correção usa saldo corrigido e salvamento sem mudança não duplica movimentos", async () => {
    await editarItensProducao(entrada([edicao(45)]));
    assert.equal(estado.movimentos.at(-1)?.quantidade, 5); assert.equal(estado.movimentos.at(-1)?.tipoMovimento, "entrada");
    const quantidade = estado.movimentos.length;
    await editarItensProducao(entrada([edicao(45)])); assert.equal(estado.movimentos.length, quantidade);
  });
  await t.test("substituir o produto estorna o anterior e registra o novo usando SKU do banco", async () => {
    reiniciar(); await editarItensProducao(entrada([{ id: null, produtoId: produtoB, quantidadeSolicitada: 7, quantidadeProduzida: 7 }]));
    assert.equal(estado.itens.length, 1); assert.equal(estado.itens[0].sku, "SKU-B");
    assert.deepEqual(saldoMovimentacoesProducao(estado.movimentos).map((saldo) => [saldo.sku, saldo.quantidade]), [["SKU-A", 0], ["SKU-B", 7]]);
  });
  await t.test("pendente, em produção e cancelada aceitam correções sem alterar estoque ou status", async () => {
    for (const status of ["pendente", "em_producao", "cancelada"]) {
      reiniciar(status); await editarItensProducao(entrada());
      assert.equal(estado.status, status); assert.equal(estado.itens[0].quantidadeProduzida, 40); assert.equal(estado.movimentos.length, 0);
    }
  });
  await t.test("dados desatualizados e item de outro pedido são recusados antes de escrever", async () => {
    reiniciar(); const antigo = entrada(); await editarItensProducao(entrada());
    const antes = JSON.stringify(estado);
    await assert.rejects(editarItensProducao(antigo), (error: { status?: number }) => error.status === 409);
    await assert.rejects(editarItensProducao(entrada([{ ...edicao(), id: produtoB }])), /não pertence/);
    assert.equal(JSON.stringify(estado), antes);
  });
  await t.test("isola aplicativos, rejeita produto inativo e mantém atomicidade se item falhar", async () => {
    reiniciar(); const antes = JSON.stringify(estado);
    await assert.rejects(editarItensProducao({ ...entrada(), aplicativoId: "outro-app" }), (error: { status?: number }) => error.status === 404);
    produtoDisponivel = false;
    await assert.rejects(editarItensProducao(entrada([{ id: null, produtoId: produtoB, quantidadeSolicitada: 1, quantidadeProduzida: 1 }])), /inativo/);
    produtoDisponivel = true; falharEscrita = true;
    await assert.rejects(editarItensProducao(entrada()), /Falha ao atualizar/); falharEscrita = false;
    assert.equal(JSON.stringify(estado), antes);
  });
  await t.test("conflito serializável retorna 409 sem repetir a mutação", async () => {
    conflitoBanco = true;
    await assert.rejects(editarItensProducao(entrada()), (error: { status?: number }) => error.status === 409);
    conflitoBanco = false;
  });
  await t.test("PATCH salva com o aplicativo e o autor autenticados, ignorando identidades do corpo", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-ficticia-de-teste";
    const { supabaseAdmin } = await import("../src/lib/supabase-admin");
    t.mock.method(supabaseAdmin.auth, "getUser", async () => ({ data: { user: { id: "usuario-http", email: "teste@example.test" } }, error: null }));
    const { PATCH } = await import("../src/app/api/solicitacoes-producao/[id]/route");
    reiniciar();
    const response = await PATCH(new Request("https://example.test", {
      method: "PATCH", headers: { Authorization: "Bearer ficticio", "Content-Type": "application/json" },
      body: JSON.stringify({ ...entrada(), aplicativoId: "app-forjado", usuarioId: "autor-forjado" }),
    }), { params: Promise.resolve({ id: pedido }) });
    assert.equal(response.status, 200);
    assert.equal(estado.itens[0].quantidadeProduzida, 40);
    assert.equal(estado.movimentos.at(-1)?.aplicativoId, app);
    assert.match(estado.movimentos.at(-1)?.observacao ?? "", /usuario-http/);
    assert.doesNotMatch(estado.movimentos.at(-1)?.observacao ?? "", /autor-forjado/);
  });
});


test("valida novos campos opcionais da edição no servidor", () => {
  const revisao = revisaoItensProducao("pendente", [item()]);
  for (const campos of [{ tipoCorte: "MANUAL" }, { tipoCorte: true }, { observacao: 123 }, { observacao: "x".repeat(5001) }]) {
    assert.throws(() => normalizarEdicaoItensProducao({ revisao, itens: [{ ...edicao(), ...campos }] }));
  }
  const dados = normalizarEdicaoItensProducao({ revisao, itens: [{ ...edicao(), tipoCorte: "LASER", observacao: "Teste" }] });
  assert.equal(dados.itens[0].tipoCorte, "LASER");
  assert.equal(dados.itens[0].observacao, "Teste");
});
