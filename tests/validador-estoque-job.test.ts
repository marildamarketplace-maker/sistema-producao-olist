import assert from "node:assert/strict";
import test from "node:test";
import { NenhumItemElegivelOlistError } from "../src/lib/olist-errors";
import {
  criarNotificationFaltaEstoque,
  executarValidadorEstoque,
  SITUACOES_VALIDADOR_ESTOQUE,
} from "../src/lib/validador-estoque-job";

function criarResultado() {
  return {
    data_entrega: "2026-10-03",
    filtro_data_base: "APROVACAO_PEDIDO" as const,
    periodo_inicio: "2026-10-03T11:00:00.000Z",
    periodo_fim: "2026-10-03T11:00:00.000Z",
    observacao_geral: "MV:",
    prioridade_producao: true,
    itens: [
      {
        produto_id: "produto-1",
        sku: "SKU-A",
        imagem_url: null,
        quantidade_solicitada: 7,
        prioridade_producao: true,
        quantidade_em_producao: 2,
        quantidade_pedidos: 10,
        estoque_atual: 1,
        pedido_olist_ids: ["123"],
        skus_olist_origem: ["SKU-A"],
      },
    ],
    itens_cobertos_producao_existente: [],
    itens_estoque_suficiente: [],
    total_itens: 1,
    itens_ja_processados: 0,
    pedidos_encontrados: 3,
    pedidos_adicionados: 3,
    pedidos_ignorados: 0,
    produtos_cadastrados: 0,
    rastreio_olist: [],
    motivo_pedidos_ignorados: "Nenhum pedido é ignorado durante a busca.",
  };
}

test("executa a mesma validação da tela com as quatro situações solicitadas", async () => {
  let inputRecebido: Record<string, unknown> | undefined;
  const resultadoEsperado = criarResultado();

  const resposta = await executarValidadorEstoque(
    {
      aplicativoId: "00000000-0000-0000-0000-000000000001",
      executadoEm: new Date("2026-10-04T01:30:00.000Z"),
    },
    async (input) => {
      inputRecebido = input;
      return resultadoEsperado;
    },
  );

  assert.deepEqual(SITUACOES_VALIDADOR_ESTOQUE, ["0", "3", "4", "1"]);
  assert.deepEqual(inputRecebido, {
    aplicativoId: "00000000-0000-0000-0000-000000000001",
    dataLimite: "2026-10-03",
    filtroDataBase: "APROVACAO_PEDIDO",
    situacoes: ["0", "3", "4", "1"],
  });
  assert.equal(resposta.tipo, "VALIDADO");
  if (resposta.tipo === "VALIDADO") {
    assert.equal(resposta.resultado, resultadoEsperado);
  }
});

test("monta alerta com os itens que precisam de nova solicitação", () => {
  const notification = criarNotificationFaltaEstoque(
    criarResultado(),
    new Date("2026-10-03T11:00:00.000Z"),
  );

  assert.ok(notification);
  assert.equal(notification.titulo, "Alerta de estoque Olist");
  assert.match(notification.mensagem, /Executado em: 03\/10\/2026, 08:00:00/);
  assert.match(notification.mensagem, /SKU-A: 7 un\. para nova solicitação/);
  assert.match(notification.mensagem, /demanda 10 \| estoque 1 \| em produção 2 \| PRIORIDADE/);
});

test("preserva resultado sem itens para produção sem criar alerta de falha", async () => {
  const resultado = criarResultado();
  resultado.itens = [];
  resultado.total_itens = 0;
  const resposta = await executarValidadorEstoque(
    { aplicativoId: "app-1" },
    async () => resultado,
  );
  assert.equal(resposta.tipo, "VALIDADO");
  if (resposta.tipo === "VALIDADO") {
    assert.equal(resposta.resultado.itens.length, 0);
  }
});

test("limita mensagens extensas e informa quantos itens foram omitidos", () => {
  const resultado = criarResultado();
  resultado.itens = Array.from({ length: 200 }, (_, indice) => ({
    ...resultado.itens[0],
    sku: `SKU-${indice}-${"X".repeat(80)}`,
  }));

  const notification = criarNotificationFaltaEstoque(resultado);

  assert.ok(notification);
  assert.ok(notification.mensagem.length <= 3_500);
  assert.match(notification.mensagem, /e mais \d+ item\(ns\)\./);
});

test("não gera alerta quando estoque cobre as vendas, mesmo havendo reposição de mínimo", () => {
  for (const estoque of [10, 12]) {
    const resultado = criarResultado();
    resultado.itens[0].estoque_atual = estoque;
    assert.equal(criarNotificationFaltaEstoque(resultado), null);
  }
});

test("não gera alerta sem itens para nova produção", () => {
  const resultado = criarResultado();
  resultado.itens = [];
  assert.equal(criarNotificationFaltaEstoque(resultado), null);
});

test("alerta misto inclui apenas os SKUs com estoque insuficiente para as vendas", () => {
  const resultado = criarResultado();
  resultado.itens.push({ ...resultado.itens[0], sku: "SKU-COBERTO", estoque_atual: 10 });
  const notification = criarNotificationFaltaEstoque(resultado);
  assert.ok(notification);
  assert.match(notification.mensagem, /SKU-A:/);
  assert.doesNotMatch(notification.mensagem, /SKU-COBERTO/);
  assert.match(notification.mensagem, /Itens: 1 SKU\(s\) \/ 7 unidade\(s\)/);
});

test("trata ausência tipada de itens como resultado normal", async () => {
  const resposta = await executarValidadorEstoque(
    { aplicativoId: "app-1", executadoEm: new Date("2026-10-03T11:00:00.000Z") },
    async () => {
      throw new NenhumItemElegivelOlistError();
    },
  );

  assert.deepEqual(resposta, {
    tipo: "SEM_ITENS_ELEGIVEIS",
    dataLimite: "2026-10-03",
  });
});

test("não confunde uma falha operacional com a mensagem do erro de domínio", async () => {
  await assert.rejects(
    executarValidadorEstoque(
      { aplicativoId: "app-1" },
      async () => {
        throw new Error("Nenhum item elegível encontrado nos pedidos da Olist.");
      },
    ),
    /Nenhum item elegível/,
  );
});
