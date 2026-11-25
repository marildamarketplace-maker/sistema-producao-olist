import type { OpcaoFilaOlist } from "./fila-olist-contrato";
import { pesquisarPaginaTecidosOlist } from "./pesquisar-tecido-olist";

export type CatalogoTecidosOlist = {
  itens: OpcaoFilaOlist[];
  carregando: boolean;
  completo: boolean;
  erro: string;
  carregarMais: () => void;
  atualizar: () => void;
  cancelar: () => void;
};

export type LoteCatalogoTecidosOlist = {
  itens: OpcaoFilaOlist[];
  proximaPagina: number;
  completo: boolean;
};

export const PAGINAS_POR_CARGA_TECIDOS = 20;

/** A assinatura temporária pode mudar sem alterar a conta ou o escopo autorizado. */
export function chaveCatalogoTecidosOlist(api: string, usuarioId: string, token: string): string {
  const indice = api.indexOf("?");
  const caminho = indice < 0 ? api : api.slice(0, indice);
  const params = new URLSearchParams(indice < 0 ? "" : api.slice(indice + 1));
  params.delete("contextoConsulta");
  params.sort();
  return JSON.stringify([usuarioId, token, caminho, params.toString()]);
}

/** Carrega somente a pesquisa Ref, em páginas limitadas, compartilhável entre linhas. */
export async function carregarLoteCatalogoTecidosOlist({ anterior, carregar, signal, aoCarregar, limitePaginas = PAGINAS_POR_CARGA_TECIDOS }: {
  anterior: LoteCatalogoTecidosOlist;
  carregar: (pagina: number) => Promise<unknown>;
  signal: AbortSignal;
  aoCarregar?: (lote: LoteCatalogoTecidosOlist) => void;
  limitePaginas?: number;
}): Promise<LoteCatalogoTecidosOlist> {
  if (!Number.isInteger(limitePaginas) || limitePaginas < 1 || limitePaginas > PAGINAS_POR_CARGA_TECIDOS) throw new Error("Limite de carregamento inválido.");
  signal.throwIfAborted();
  if (anterior.completo) return anterior;
  let lote = anterior;
  const produtos = new Map(anterior.itens.map(item => [item.id, item]));
  for (let indice = 0; indice < limitePaginas; indice++) {
    signal.throwIfAborted();
    if (lote.proximaPagina > 1000) throw new Error("A lista excedeu o limite de páginas da Olist. Atualize os produtos para tentar novamente.");
    const pagina = await pesquisarPaginaTecidosOlist("ref", lote.proximaPagina, carregar);
    signal.throwIfAborted();
    if (pagina.itens.length && pagina.itens.every(item => produtos.has(item.id)) && pagina.mais) {
      throw new Error("A Olist repetiu uma página de produtos. Atualize a lista para tentar novamente.");
    }
    for (const item of pagina.itens) produtos.set(item.id, item);
    lote = { itens: [...produtos.values()], proximaPagina: pagina.pagina + 1, completo: !pagina.mais };
    aoCarregar?.(lote);
    if (lote.completo) break;
  }
  return lote;
}
