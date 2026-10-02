export type FiltroDataPedidosOlist =
  | {
      tipo: "criacao";
      periodoInicio: Date | null;
      periodoFim: Date | null;
    }
  | {
      tipo: "atualizacao";
      desde: Date;
    };

const JANELA_PADRAO_ATUALIZACAO_DIAS = 7;

function formatarDataOlist(data: Date) {
  return data.toISOString().slice(0, 10);
}

export function obterDataAtualizacaoPadrao(referencia = new Date()) {
  return new Date(
    referencia.getTime() -
      JANELA_PADRAO_ATUALIZACAO_DIAS * 24 * 60 * 60 * 1000,
  );
}

export function aplicarFiltroDataPedidosOlist(
  url: URL,
  filtro: FiltroDataPedidosOlist,
) {
  if (filtro.tipo === "atualizacao") {
    url.searchParams.set("dataAtualizacao", formatarDataOlist(filtro.desde));
    return;
  }

  if (filtro.periodoInicio && filtro.periodoFim) {
    url.searchParams.set("dataInicial", formatarDataOlist(filtro.periodoInicio));
    url.searchParams.set("dataFinal", formatarDataOlist(filtro.periodoFim));
  }
}
