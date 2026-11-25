import type { ItemPedidoManual } from "./pedido-manual-contrato";

export const modalidadesPedido = {
  TECIDO_LISO: "Tecido sem estampa",
  TECIDO_SUBLIMADO: "Tecido sublimado",
  PRODUTO_SUBLIMADO: "Produto sublimado",
} as const;
export type ModalidadePedido = keyof typeof modalidadesPedido;
export type TamanhoPedido = { id: string; titulo: string; sku: string; consumo: number | null };
export const metrosPedido = (pecas: number, consumo: number) => Number((pecas * consumo).toFixed(6));
export function trocarModalidade(item: ItemPedidoManual, modalidade: ModalidadePedido): Partial<ItemPedidoManual> {
  const produto = modalidade === "PRODUTO_SUBLIMADO";
  return { modalidade, quantidade: produto ? item.quantidade || 1 : 0,
    ...(produto ? {} : { tamanho: "", tamanhoId: null, tipoProduto: "", corteLaser: false, modoMetragem: "MANUAL" as const, consumoUnidade: null, revisarMetragem: false }),
    ...(modalidade === "TECIDO_LISO" ? { estampa: "", variante: null } : {}) };
}
export function alterarPecas(item: ItemPedidoManual, quantidade: number): Partial<ItemPedidoManual> {
  return { quantidade, ...(item.modoMetragem === "AUTOMATICA" && item.consumoUnidade
    ? { quantidadeTecido: metrosPedido(quantidade, item.consumoUnidade) }
    : { revisarMetragem: true }) };
}
export function selecionarTamanho(item: ItemPedidoManual, tamanho: TamanhoPedido, manterAjuste = false): Partial<ItemPedidoManual> {
  const automatico = !manterAjuste && tamanho.consumo !== null && tamanho.consumo > 0;
  return { tamanho: tamanho.sku, tamanhoId: tamanho.id, consumoUnidade: tamanho.consumo && tamanho.consumo > 0 ? tamanho.consumo : null,
    modoMetragem: automatico ? "AUTOMATICA" : "MANUAL", revisarMetragem: !automatico && !manterAjuste,
    ...(automatico ? { quantidadeTecido: metrosPedido(item.quantidade, tamanho.consumo!) } : {}) };
}
export function resumirItensPedido(itens: ItemPedidoManual[]) {
  return itens.reduce((total, item) => ({ pecas: total.pecas + (item.modalidade && item.modalidade !== "PRODUTO_SUBLIMADO" ? 0 : item.quantidade),
    metros: metrosPedido(1, total.metros + item.quantidadeTecido), laser: metrosPedido(1, total.laser + (item.corteLaser ? item.quantidadeTecido : 0)) }), { pecas: 0, metros: 0, laser: 0 });
}
