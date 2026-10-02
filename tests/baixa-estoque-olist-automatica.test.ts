import assert from "node:assert/strict";
import test from "node:test";
import {
  executarBaixaAutomaticaEstoqueOlist,
  type ResultadoBuscaBaixaAutomatica,
} from "../src/lib/baixa-estoque-olist-automatica";
import {
  criarErroNotificationBaixaEstoqueOlist,
  criarResumoNotificationBaixaEstoqueOlist,
} from "../src/lib/notificacoes-baixa-estoque-olist";

function criarResultadoBusca(
  patch: Partial<ResultadoBuscaBaixaAutomatica> = {},
): ResultadoBuscaBaixaAutomatica {
  return {
    periodo_inicio: "2026-10-01T02:50:00.000Z",
    periodo_fim: "2026-10-02T02:50:00.000Z",
    pedidos_encontrados: 1,
    pedidos_ignorados: 0,
    pedidos: [
      {
        id: "123",
        detalhe_pendente: false,
        itens: [
          {
            sku: "SKU-A",
            quantidade: 2,
            pedido_olist_id: "123",
            item_olist_id: "SKU-A",
          },
        ],
      },
    ],
    ...patch,
  };
}

test("confirma automaticamente todos os pedidos detalhados e avança o cursor", async () => {
  let payloadConfirmacao: unknown;
  let conclusoesSemBaixa = 0;

  const resultado = await executarBaixaAutomaticaEstoqueOlist({
    buscarPedidos: async () => criarResultadoBusca(),
    confirmarBaixa: async (input) => {
      payloadConfirmacao = input;
      return { baixa_id: "baixa-1", itens: input.itens.length };
    },
    concluirBuscaSemBaixa: async () => {
      conclusoesSemBaixa += 1;
    },
  });

  assert.deepEqual(payloadConfirmacao, {
    origem: "automatica",
    observacao: "Baixa automatica Olist executada pelo cron diario.",
    periodoFimBusca: "2026-10-02T02:50:00.000Z",
    itens: [
      {
        sku: "SKU-A",
        quantidade: 2,
        pedidoOlistId: "123",
        itemOlistId: "SKU-A",
        observacao: "Baixa automatica Olist 123 via cron",
      },
    ],
  });
  assert.equal(conclusoesSemBaixa, 0);
  assert.equal(resultado.pedidos_confirmados, 1);
  assert.equal(resultado.itens_baixados, 1);
  assert.equal(resultado.cursor_atualizado, true);
});

test("confirma pedidos prontos sem avançar o cursor quando há detalhe pendente", async () => {
  let periodoFimConfirmado: string | null | undefined;

  const resultado = await executarBaixaAutomaticaEstoqueOlist({
    buscarPedidos: async () =>
      criarResultadoBusca({
        pedidos_encontrados: 2,
        pedidos_detalhe_pendente: 1,
        pedidos: [
          ...criarResultadoBusca().pedidos,
          {
            id: "456",
            detalhe_pendente: true,
            itens: [
              {
                sku: "",
                quantidade: 1,
                pedido_olist_id: "456",
                item_olist_id: "",
                detalhe_pendente: true,
              },
            ],
          },
        ],
      }),
    confirmarBaixa: async (input) => {
      periodoFimConfirmado = input.periodoFimBusca;
      return { baixa_id: "baixa-2", itens: input.itens.length };
    },
    concluirBuscaSemBaixa: async () => {
      assert.fail("não deve concluir uma busca parcial");
    },
  });

  assert.equal(periodoFimConfirmado, null);
  assert.equal(resultado.pedidos_confirmados, 1);
  assert.equal(resultado.pedidos_pendentes, 1);
  assert.equal(resultado.cursor_atualizado, false);
});

test("avança o cursor quando a busca completa não encontra pedidos novos", async () => {
  let periodoConcluido: string | undefined;

  const resultado = await executarBaixaAutomaticaEstoqueOlist({
    buscarPedidos: async () =>
      criarResultadoBusca({
        pedidos_encontrados: 0,
        pedidos: [],
      }),
    confirmarBaixa: async () => {
      assert.fail("não deve criar uma baixa vazia");
    },
    concluirBuscaSemBaixa: async (periodoFim) => {
      periodoConcluido = periodoFim;
    },
  });

  assert.equal(periodoConcluido, "2026-10-02T02:50:00.000Z");
  assert.equal(resultado.itens_baixados, 0);
  assert.equal(resultado.cursor_atualizado, true);
});

test("interrompe a execução quando um item detalhado é inválido", async () => {
  await assert.rejects(
    executarBaixaAutomaticaEstoqueOlist({
      buscarPedidos: async () =>
        criarResultadoBusca({
          pedidos: [
            {
              id: "789",
              itens: [
                {
                  sku: "",
                  quantidade: 1,
                  pedido_olist_id: "789",
                  item_olist_id: "",
                },
              ],
            },
          ],
        }),
      confirmarBaixa: async () => {
        assert.fail("não deve confirmar item inválido");
      },
      concluirBuscaSemBaixa: async () => {
        assert.fail("não deve avançar o cursor com item inválido");
      },
    }),
    /Pedido Olist 789 retornou item invalido/,
  );
});

test("não avança o cursor quando um pedido detalhado retorna sem itens", async () => {
  await assert.rejects(
    executarBaixaAutomaticaEstoqueOlist({
      buscarPedidos: async () =>
        criarResultadoBusca({
          pedidos: [{ id: "999", detalhe_pendente: false, itens: [] }],
        }),
      confirmarBaixa: async () => {
        assert.fail("não deve confirmar pedido vazio");
      },
      concluirBuscaSemBaixa: async () => {
        assert.fail("não deve avançar o cursor com pedido vazio");
      },
    }),
    /Pedido Olist 999 retornou sem itens/,
  );
});

test("monta o resumo da baixa com quantidades e datas", () => {
  const notification = criarResumoNotificationBaixaEstoqueOlist(
    {
      periodo_inicio: "2026-10-01T02:50:00.000Z",
      periodo_fim: "2026-10-02T02:50:00.000Z",
      pedidos_encontrados: 4,
      pedidos_ignorados: 1,
      pedidos_confirmados: 2,
      pedidos_pendentes: 1,
      itens_baixados: 3,
      baixa_id: "baixa-1",
      cursor_atualizado: false,
    },
    new Date("2026-10-02T12:00:00.000Z"),
  );

  assert.equal(notification.titulo, "Resumo da baixa automática de estoque Olist");
  assert.match(notification.mensagem, /Executada em: 02\/10\/2026, 09:00:00/);
  assert.match(notification.mensagem, /Período consultado: 30\/09\/2026, 23:50:00 até 01\/10\/2026, 23:50:00/);
  assert.match(notification.mensagem, /Sucessos: 2 pedido\(s\) e 3 item\(ns\)/);
  assert.match(notification.mensagem, /Erros: 0/);
  assert.match(notification.mensagem, /Pendentes: 1 pedido\(s\)/);
});

test("monta a notification de qualquer erro sem incluir stack trace", () => {
  const notification = criarErroNotificationBaixaEstoqueOlist({
    error: new Error("Falha ao confirmar a baixa"),
    aplicativoId: "00000000-0000-0000-0000-000000000001",
    ocorridoEm: new Date("2026-10-02T12:00:00.000Z"),
  });

  assert.equal(notification.titulo, "Erro na baixa automática de estoque Olist");
  assert.match(notification.mensagem, /Data do erro: 02\/10\/2026, 09:00:00/);
  assert.match(notification.mensagem, /Erros: 1/);
  assert.match(notification.mensagem, /Detalhe: Falha ao confirmar a baixa/);
  assert.doesNotMatch(notification.mensagem, /at .*\.ts:/);
});
