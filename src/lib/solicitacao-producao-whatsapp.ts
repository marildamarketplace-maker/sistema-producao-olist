import { extrairConsumosProducao } from "./producao-totais";

type ItemCompartilhamento = {
  sku: string;
  quantidade_solicitada: number;
  tipo_corte: string | null;
  observacao: string | null;
};

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

export function montarSolicitacaoProducaoWhatsapp(itens: ItemCompartilhamento[]) {
  if (!itens.length) throw new Error("A solicitação não possui itens para compartilhar.");
  const totais = new Map<string, number>();
  let semMetragem = 0;
  const blocos = itens.map((item) => {
    const observacao = (item.observacao ?? "")
      .replace(/<!--produto-fornecido:(?:start|end)-->/g, "")
      .replace(/^Produto fornecido:\s*/gim, "")
      .trim();
    const consumos = extrairConsumosProducao(item.observacao);
    if (!consumos.length) semMetragem++;
    for (const consumo of consumos) {
      const { metros, tecido } = consumo;
      if (!Number.isFinite(metros) || metros < 0) throw new Error(`Metragem inválida no item ${item.sku}.`);
      // A referência numérica continua no item; o resumo agrupa pelo nome do tecido.
      totais.set(tecido, (totais.get(tecido) ?? 0) + metros);
    }
    const laser = item.tipo_corte === "LASER"
      ? (/\bcom papel\b/i.test(observacao) ? "Sim com papel" : "Sim")
      : "Não";
    return [
      item.sku,
      `Quantidade: ${decimal.format(item.quantidade_solicitada)} ${item.quantidade_solicitada === 1 ? "unidade" : "unidades"}`,
      `Corte a laser: ${laser}`,
      observacao.replace(/(\d)\s+x\s+(\d)/g, "$1 × $2"),
    ].filter(Boolean).join("\n");
  });
  return [
    "SOLICITAÇÃO DE PRODUÇÃO",
    ...blocos,
    [
      "TOTAL DE TECIDO",
      ...Array.from(totais, ([tecido, metros]) => `${tecido}: ${decimal.format(metros)} m`),
      `${semMetragem ? "Total parcial informado" : "Total geral"}: ${decimal.format([...totais.values()].reduce((a, b) => a + b, 0))} m`,
      ...(semMetragem ? [`${semMetragem} item(ns) sem metragem informada.`] : []),
    ].join("\n"),
  ].join("\n\n");
}
