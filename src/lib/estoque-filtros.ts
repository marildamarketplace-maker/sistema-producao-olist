export type FiltrosEstoque = {
  sku: string;
  saldo: "todos" | "positivo" | "zero" | "negativo";
  meta: "todas" | "abaixo" | "atingida";
  movimentacoes: "todas" | "com" | "sem";
  imagem: "todas" | "com" | "sem";
};

export const FILTROS_ESTOQUE_INICIAIS: FiltrosEstoque = {
  sku: "", saldo: "todos", meta: "todas", movimentacoes: "todas", imagem: "todas",
};

type ItemEstoque = {
  sku: string;
  saldo_atual: number;
  meta_aplicada: number;
  qtd_movimentacoes: number;
  imagem_url: string | null;
};

export function filtrarEstoque<T extends ItemEstoque>(linhas: T[], filtros: FiltrosEstoque): T[] {
  const busca = filtros.sku.trim().toLocaleLowerCase("pt-BR");
  return linhas.filter((linha) => {
    if (busca && !linha.sku.toLocaleLowerCase("pt-BR").includes(busca)) return false;
    if (filtros.saldo === "positivo" && linha.saldo_atual <= 0) return false;
    if (filtros.saldo === "zero" && linha.saldo_atual !== 0) return false;
    if (filtros.saldo === "negativo" && linha.saldo_atual >= 0) return false;
    if (filtros.meta === "abaixo" && linha.saldo_atual >= linha.meta_aplicada) return false;
    if (filtros.meta === "atingida" && linha.saldo_atual < linha.meta_aplicada) return false;
    if (filtros.movimentacoes === "com" && linha.qtd_movimentacoes === 0) return false;
    if (filtros.movimentacoes === "sem" && linha.qtd_movimentacoes !== 0) return false;
    if (filtros.imagem === "com" && !linha.imagem_url) return false;
    if (filtros.imagem === "sem" && linha.imagem_url) return false;
    return true;
  });
}
