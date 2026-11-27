import type { ProdutoEvento } from "./produtos";

export type SelecaoProdutos = Record<string, { produto: ProdutoEvento; selecionado: boolean }>;

export function selecionarPagina(anterior: SelecaoProdutos, produtos: ProdutoEvento[], selecionado: boolean): SelecaoProdutos {
  const proximo = { ...anterior };
  for (const produto of produtos) {
    // Inativos podem ser removidos, mas não associados novamente.
    if (selecionado && !produto.ativo) continue;
    if (selecionado === produto.associado) delete proximo[produto.id];
    else proximo[produto.id] = { produto, selecionado };
  }
  if (Object.keys(proximo).length > 100) {
    throw new Error("O limite é de 100 alterações por salvamento. Salve as alterações antes de selecionar mais produtos.");
  }
  return proximo;
}
