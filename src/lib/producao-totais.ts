type ItemTotais = {
  quantidadeSolicitada: number;
  tipoCorte: string | null;
  observacao: string | null;
};

/** Consumos já incluem a quantidade de peças; não multiplicar novamente. */
export function extrairConsumosProducao(observacao: string | null) {
  const texto = (observacao ?? "")
    .replace(/<!--produto-fornecido:(?:start|end)-->/g, "")
    .replace(/^Produto fornecido:\s*/gim, "")
    .trim();
  return [...texto.matchAll(/(?:^|\n)\s*([\d.,]+)\s*m de\s+(.+?)\s*\(([^\n]+)\)\.?\s*(?=\n|$)/g)]
    .map((consumo) => ({
      metros: Number(consumo[1].replace(/\./g, "").replace(",", ".")),
      tecido: consumo[2].trim().replace(/\s+\d+$/, "").toUpperCase(),
    }));
}

export function calcularTotaisProducao(itens: readonly ItemTotais[]) {
  let quantidade = 0;
  let comLaser = 0;
  let semLaser = 0;
  let itensSemMetragem = 0;
  for (const item of itens) {
    quantidade += item.quantidadeSolicitada;
    const consumos = extrairConsumosProducao(item.observacao);
    const validos = consumos.filter(({ metros }) => Number.isFinite(metros) && metros >= 0);
    if (!consumos.length || validos.length !== consumos.length) itensSemMetragem++;
    const metros = validos.reduce((total, consumo) => total + consumo.metros, 0);
    if (item.tipoCorte === "LASER") comLaser += metros;
    else semLaser += metros;
  }
  return { quantidade, comLaser, semLaser, metragem: comLaser + semLaser, itensSemMetragem };
}
