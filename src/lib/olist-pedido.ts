export type DivisaoInfoAdicionalOlist = {
  quantidade?: unknown;
  estampa?: unknown;
  variante?: unknown;
  unidade?: unknown;
  laser?: unknown;
  tamanho?: unknown;
  tipo?: unknown;
};

export type LinhaObservacaoPedidoOlist = {
  descricao: unknown;
  quantidade: unknown;
  unidade: unknown;
  estampa: unknown;
  variante: unknown;
  laser?: unknown;
  tamanho?: unknown;
  tipo?: unknown;
};

function valorBooleano(valor: unknown) {
  return valor === true || valor === 1 || String(valor ?? "").trim().toLowerCase() === "true";
}

export function extrairTamanhoSku(sku: string) {
  const tamanho = sku.match(/(?:^|-)TA\/([^\/-]+)/i)?.[1] ?? "";
  return tamanho.replace(/X/g, "x");
}

export function extrairTipoProdutoSku(sku: string) {
  return sku.match(/^TP\/(.+?)-C\//i)?.[1] ?? "";
}

export function escaparXml(valor: unknown) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function criarInfoAdicionalOlist(
  divisoes: DivisaoInfoAdicionalOlist[],
  unidadePadrao: string,
  opcoes: { incluirTagsVazias?: boolean } = {},
) {
  return divisoes.map((divisao) => {
    const estampa = String(divisao.estampa ?? "").trim();
    const variante = String(divisao.variante ?? "").trim();
    const unidade = String(divisao.unidade ?? unidadePadrao).trim() || unidadePadrao;
    const laser = valorBooleano(divisao.laser);
    const tamanho = String(divisao.tamanho ?? "").trim();
    const tipo = String(divisao.tipo ?? "").trim();
    const tagEstampa = estampa || opcoes.incluirTagsVazias
      ? `<COD>${escaparXml(estampa)}</COD>`
      : "";
    const tagVariante = variante || opcoes.incluirTagsVazias
      ? `<VAR>${escaparXml(variante)}</VAR>`
      : "";

    return `<ESTAMPA>${tagEstampa}${tagVariante}<QTD>${escaparXml(divisao.quantidade)}</QTD>` +
      `<UN>${escaparXml(unidade)}</UN><TAM>${escaparXml(tamanho)}</TAM>` +
      `<TIPO>${escaparXml(tipo)}</TIPO>` +
      `<LASER>${laser}</LASER></ESTAMPA>`;
  }).join("");
}

export function criarLinhaObservacaoPedidoOlist(linha: LinhaObservacaoPedidoOlist) {
  const estampa = String(linha.estampa ?? "").trim();
  const variante = String(linha.variante ?? "").trim();
  const estampaVariante = [estampa, variante].filter(Boolean).join("-");
  const quantidadeUnidade = [
    String(linha.quantidade ?? "").trim(),
    String(linha.unidade ?? "").trim(),
  ].filter(Boolean).join(" ");
  const partes = [
    String(linha.descricao ?? "").trim(),
    String(linha.tipo ?? "").trim(),
    quantidadeUnidade,
    String(linha.tamanho ?? "").trim(),
    estampaVariante,
    valorBooleano(linha.laser) ? "CORTE LASER" : "",
  ].filter(Boolean);

  return partes.join("     |     ");
}

export function criarObservacoesPedidoOlist(linhas: LinhaObservacaoPedidoOlist[]) {
  return linhas.map(criarLinhaObservacaoPedidoOlist).join("\n.\n");
}
