type ResultadoBaixaAutomatica = {
  periodo_inicio: string;
  periodo_fim: string;
  pedidos_encontrados: number;
  pedidos_ignorados: number;
  pedidos_confirmados: number;
  pedidos_pendentes: number;
  itens_baixados: number;
  baixa_id: string | null;
  cursor_atualizado: boolean;
};

type ConteudoNotification = {
  titulo: string;
  mensagem: string;
};

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

function formatarDataHora(data: Date | string) {
  const dataNormalizada = data instanceof Date ? data : new Date(data);
  return Number.isNaN(dataNormalizada.getTime())
    ? String(data)
    : formatadorDataHora.format(dataNormalizada);
}

export function criarResumoNotificationBaixaEstoqueOlist(
  resultado: ResultadoBaixaAutomatica,
  executadoEm = new Date(),
): ConteudoNotification {
  return {
    titulo: "Resumo da baixa automática de estoque Olist",
    mensagem: [
      "Baixa automática de estoque Olist concluída.",
      "",
      `Executada em: ${formatarDataHora(executadoEm)}`,
      `Período consultado: ${formatarDataHora(resultado.periodo_inicio)} até ${formatarDataHora(resultado.periodo_fim)}`,
      `Sucessos: ${resultado.pedidos_confirmados} pedido(s) e ${resultado.itens_baixados} item(ns) baixado(s)`,
      `Pendentes: ${resultado.pedidos_pendentes} pedido(s)`,
      `Ignorados: ${resultado.pedidos_ignorados} pedido(s)`,
      `Encontrados: ${resultado.pedidos_encontrados} pedido(s)`,
      `Baixa: ${resultado.baixa_id ?? "nenhuma baixa criada"}`,
      `Cursor atualizado: ${resultado.cursor_atualizado ? "sim" : "não"}`,
    ].join("\n"),
  };
}

export function criarErroNotificationBaixaEstoqueOlist(input: {
  error: unknown;
  aplicativoId?: string | null;
  ocorridoEm?: Date;
}): ConteudoNotification {
  const mensagemErro = input.error instanceof Error
    ? input.error.message
    : "Erro inesperado ao executar o job.";

  return {
    titulo: "Erro na baixa automática de estoque Olist",
    mensagem: [
      "O job de baixa automática de estoque Olist falhou.",
      "",
      `Data do erro: ${formatarDataHora(input.ocorridoEm ?? new Date())}`,
      `Aplicativo: ${input.aplicativoId ?? "não identificado"}`,
      `Detalhe: ${mensagemErro.slice(0, 1_000)}`,
    ].join("\n"),
  };
}
