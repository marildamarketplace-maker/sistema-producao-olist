export const FILTROS_SOLICITACOES_INICIAIS = {
  observacao: "",
  status: "",
  entregaInicio: "",
  entregaFim: "",
  criacaoInicio: "",
  criacaoFim: "",
  pedidoOlist: "",
};

export type FiltrosSolicitacoes = typeof FILTROS_SOLICITACOES_INICIAIS;

type SolicitacaoFiltravel = {
  id: string;
  observacao_geral: string | null;
  status: string;
  data_entrega: string;
  created_at: string;
};

function normalizarBusca(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

const formatoDataCriacao = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});

function dataCriacaoLocal(valor: string) {
  const partes = formatoDataCriacao.formatToParts(new Date(valor));
  return ["year", "month", "day"].map((tipo) => partes.find((parte) => parte.type === tipo)?.value).join("-");
}

export function filtrarSolicitacoes<T extends SolicitacaoFiltravel>(
  solicitacoes: readonly T[],
  filtros: FiltrosSolicitacoes,
  pedidosPorSolicitacao: Readonly<Record<string, readonly string[]>>,
): T[] {
  const observacao = normalizarBusca(filtros.observacao);
  const pedido = filtros.pedidoOlist.trim();
  return solicitacoes.filter((solicitacao) => {
    if (observacao && !normalizarBusca(solicitacao.observacao_geral ?? "").includes(observacao)) return false;
    if (filtros.status && solicitacao.status !== filtros.status) return false;
    if (filtros.entregaInicio && solicitacao.data_entrega < filtros.entregaInicio) return false;
    if (filtros.entregaFim && solicitacao.data_entrega > filtros.entregaFim) return false;
    if (filtros.criacaoInicio || filtros.criacaoFim) {
      const criacao = dataCriacaoLocal(solicitacao.created_at);
      if (filtros.criacaoInicio && criacao < filtros.criacaoInicio) return false;
      if (filtros.criacaoFim && criacao > filtros.criacaoFim) return false;
    }
    return !pedido || (pedidosPorSolicitacao[solicitacao.id] ?? []).some((id) => id.includes(pedido));
  });
}
