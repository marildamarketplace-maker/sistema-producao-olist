const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1_000;
const LIMITE_DETALHES_MENSAGEM = 15;

export type ProducaoPendenteConfirmacao = {
  id: string;
  createdAt: Date;
  dataEntrega: Date;
  prioridadeProducao: boolean;
  quantidadeItens: number;
  quantidadeUnidades: number;
};

type ConteudoWhatsapp = {
  titulo: string;
  mensagem: string;
};

const formatadorData = new Intl.DateTimeFormat("pt-BR", {
  // data_entrega é DATE no Postgres e chega como meia-noite UTC pelo Prisma.
  // UTC evita exibir o dia anterior no fuso de São Paulo.
  timeZone: "UTC",
});

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function obterLimiteConfirmacao(atual = new Date()) {
  if (Number.isNaN(atual.getTime())) throw new Error("Data atual inválida.");
  return new Date(atual.getTime() - DOIS_DIAS_MS);
}

export function criarAlertaConfirmacaoEntregaProducao(input: {
  producoes: ProducaoPendenteConfirmacao[];
  agora?: Date;
  urlConfirmacao?: string | null;
}): ConteudoWhatsapp {
  const agora = input.agora ?? new Date();
  const totalItens = input.producoes.reduce(
    (total, producao) => total + producao.quantidadeItens,
    0,
  );
  const totalUnidades = input.producoes.reduce(
    (total, producao) => total + producao.quantidadeUnidades,
    0,
  );
  const prioritarias = input.producoes.filter(
    (producao) => producao.prioridadeProducao,
  ).length;
  const detalhes = input.producoes
    .slice(0, LIMITE_DETALHES_MENSAGEM)
    .map((producao, indice) => {
      const dias = Math.floor(
        (agora.getTime() - producao.createdAt.getTime()) / (24 * 60 * 60 * 1_000),
      );
      return [
        `${indice + 1}.`,
        producao.prioridadeProducao ? "🚨 PRIORIDADE ·" : "",
        `Entrega ${formatadorData.format(producao.dataEntrega)} ·`,
        `criada há ${dias} dias ·`,
        `${producao.quantidadeItens} item(ns) ·`,
        `${producao.quantidadeUnidades} un.`,
      ].filter(Boolean).join(" ");
    });

  return {
    titulo: "Confirmação de entrega de produção pendente",
    mensagem: [
      `Existem *${input.producoes.length} produções* sem confirmação há mais de 2 dias${prioritarias > 0 ? `, sendo *${prioritarias} prioritárias*` : ""}.`,
      `Total pendente: *${totalItens} itens / ${totalUnidades} unidades*.`,
      "",
      ...detalhes,
      ...(input.producoes.length > detalhes.length
        ? ["", `E mais ${input.producoes.length - detalhes.length} produções.`]
        : []),
      "",
      "Confirme a entrega da produção o quanto antes.",
      ...(input.urlConfirmacao ? [input.urlConfirmacao] : []),
    ].join("\n"),
  };
}

export function criarAlertaErroConfirmacaoEntregaProducao(input: {
  error: unknown;
  aplicativoId?: string | null;
  ocorridoEm?: Date;
}): ConteudoWhatsapp {
  const detalhe = input.error instanceof Error
    ? input.error.message
    : "Erro inesperado ao executar o job.";

  return {
    titulo: "Erro na confirmação de entrega de produção",
    mensagem: [
      "O job CONFIRMACAO_ENTREGA_PRODUCAO falhou.",
      "",
      `Data do erro: ${formatadorDataHora.format(input.ocorridoEm ?? new Date())}`,
      `Aplicativo: ${input.aplicativoId ?? "não identificado"}`,
      `Detalhe: ${detalhe.slice(0, 1_000)}`,
    ].join("\n"),
  };
}
