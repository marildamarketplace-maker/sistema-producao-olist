export const OPCOES_METRAGEM = [
  { valor: "total_entradas", rotulo: "Total de entradas" },
  { valor: "total_saidas", rotulo: "Saídas" },
  { valor: "saldo_atual", rotulo: "Saldo atual" },
] as const;
export type BaseMetragem = typeof OPCOES_METRAGEM[number]["valor"];
export type ProdutoMetragem = {
  produto_fornecido: { nome: string; metros_por_unidade: number } | null;
};
type Linha = ProdutoMetragem & {
  sku: string;
  qtd_movimentacoes: number;
  total_entradas: number;
  total_saidas: number;
  saldo_atual: number;
};

function campo(valor: string | number | { numero: string }) {
  if (typeof valor === "object") return `"${valor.numero}"`;
  // Neutraliza fórmulas quando o relatório é aberto em uma planilha.
  const texto = typeof valor === "string" && /^[\s]*[=+\-@]/.test(valor) ? `'${valor}` : String(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}
function decimal(valor: number) {
  return { numero: valor.toFixed(4).replace(".", ",") };
}

/** Simulação pelo cadastro atual; não representa consumo histórico de produção. */
export function gerarSimulacaoMetragemCsv(linhas: readonly Linha[], base: BaseMetragem) {
  const rotulo = OPCOES_METRAGEM.find((opcao) => opcao.valor === base)?.rotulo;
  if (!rotulo) throw new Error("Base de simulação inválida.");
  const tabela: (string | number | { numero: string })[][] = [["SKU", "Base", "Quantidade", "Produto fornecido", "Consumo por unidade (m)", "Metragem total (m)", "Situação"]];
  for (const linha of linhas) {
    if (linha.qtd_movimentacoes === 0) continue;
    const produto = linha.produto_fornecido;
    const consumo = produto?.metros_por_unidade;
    const valido = typeof consumo === "number" && Number.isFinite(consumo) && consumo > 0;
    const total = valido ? linha[base] * consumo : null;
    const calculavel = total !== null && Number.isFinite(total);
    tabela.push([linha.sku, rotulo, linha[base], produto?.nome ?? "", valido ? decimal(consumo) : "",
      calculavel ? decimal(total) : "", !produto ? "Sem produto fornecido" : !calculavel ? "Consumo inválido" : "Calculado"]);
  }
  return tabela.map((linha) => linha.map(campo).join(";")).join("\r\n");
}
