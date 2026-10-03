const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1_000;

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
  producao: ProducaoPendenteConfirmacao;
  agora?: Date;
  urlConfirmacao?: string | null;
}): ConteudoWhatsapp {
  const agora = input.agora ?? new Date();
  const { producao } = input;
  const dias = Math.floor(
    (agora.getTime() - producao.createdAt.getTime()) / (24 * 60 * 60 * 1_000),
  );

  return {
    titulo: "Confirmação de entrega de produção pendente",
    mensagem: [
      producao.prioridadeProducao ? "🚨 *PRODUÇÃO PRIORITÁRIA*" : "",
      "Esta entrega de produção está sem confirmação há mais de 2 dias.",
      "",
      `Entrega: *${formatadorData.format(producao.dataEntrega)}*`,
      `Criada há: *${dias} dias*`,
      `Total: *${producao.quantidadeItens} item(ns) / ${producao.quantidadeUnidades} unidades*`,
      "",
      "Confirme a entrega da produção o quanto antes.",
      ...(input.urlConfirmacao ? [input.urlConfirmacao] : []),
    ].filter((linha, indice, linhas) => linha !== "" || linhas[indice - 1] !== "").join("\n"),
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
