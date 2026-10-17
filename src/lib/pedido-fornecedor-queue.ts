import { extrairTamanhoSku, extrairTipoProdutoSku } from "@/lib/olist-pedido";

type Item = { produtoId: string; sku: string; quantidadeSolicitada: number; tipoCorte: string | null };
type Associacao = {
  produtoId: string;
  quantidadeUsada: unknown;
  produtoFornecedor: { id: string; nome: string; referencia: string | null };
};

/** Snapshot por SKU: preserva unidades do pedido e consumo em metros separadamente. */
export function montarDadosPedidoFila(itens: Item[], associacoes: Associacao[], permitirSemTecido = false) {
  if (!itens.length) throw new Error("A solicitação não possui produtos.");
  const porProduto = new Map(associacoes.map((a) => [a.produtoId, a]));
  return {
    versao: 1 as const,
    itens: itens.map((item) => {
      const associacao = porProduto.get(item.produtoId);
      if (!associacao && !permitirSemTecido) throw new Error(`Produto ${item.sku} sem tecido vinculado ao fornecedor selecionado.`);
      const consumo = associacao ? Number(associacao.quantidadeUsada) : 0;
      const metros = consumo * item.quantidadeSolicitada;
      if (!Number.isInteger(item.quantidadeSolicitada) || item.quantidadeSolicitada <= 0 || !Number.isFinite(metros) || (associacao && metros <= 0)) {
        throw new Error(`Quantidade ou consumo de tecido inválido para ${item.sku}.`);
      }
      const estampaSku = item.sku.match(/(?:^|-)EST\/([^/]+)(?:\/|$)/i)?.[1] ?? "";
      const separador = estampaSku.indexOf("-");
      return {
        produtoId: item.produtoId,
        sku: item.sku,
        tecido: associacao ? { id: associacao.produtoFornecedor.id, nome: associacao.produtoFornecedor.nome, referencia: associacao.produtoFornecedor.referencia } : { id: item.produtoId, nome: "", referencia: null },
        quantidade: item.quantidadeSolicitada,
        unidade: "UN" as const,
        quantidadeTecido: Number(metros.toFixed(6)),
        unidadeTecido: "MT" as const,
        estampa: separador < 0 ? estampaSku : estampaSku.slice(0, separador),
        variante: separador < 0 ? null : estampaSku.slice(separador + 1) || null,
        corteLaser: item.tipoCorte === "LASER",
        tamanho: extrairTamanhoSku(item.sku),
        tipoProduto: extrairTipoProdutoSku(item.sku),
      };
    }),
  };
}
