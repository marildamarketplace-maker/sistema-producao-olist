const PRAZO_CONFIRMACAO_MS = 24 * 60 * 60 * 1_000;

export type ProducaoPendenteConfirmacao = {
  id: string;
  createdAt: Date;
  dataEntrega: Date;
  prioridadeProducao: boolean;
  observacaoGeral?: string | null;
  quantidadeItens: number;
  quantidadeUnidades: number;
};

type ConteudoWhatsapp = {
  titulo: string;
  mensagem: string;
};

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function obterLimiteConfirmacao(atual = new Date()) {
  if (Number.isNaN(atual.getTime())) throw new Error("Data atual inválida.");
  return new Date(atual.getTime() - PRAZO_CONFIRMACAO_MS);
}

export function criarAlertaConfirmacaoEntregaProducao(input: {
  producao: ProducaoPendenteConfirmacao;
  agora?: Date;
  urlConfirmacao?: string | null;
}): ConteudoWhatsapp {
  const { producao } = input;
  const observacao = producao.observacaoGeral?.trim();

  return {
    titulo: `${producao.prioridadeProducao ? "🚨" : "⏰"} Confirmação de entrega de produção pendente`,
    mensagem: [
      ...(observacao ? [observacao] : []),
      `Total: *${producao.quantidadeItens} item(ns) / ${producao.quantidadeUnidades} unidades*`,
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
