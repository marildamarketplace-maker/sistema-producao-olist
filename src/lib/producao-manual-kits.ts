import { expandirItemKit } from "./kits-estoque";

export type OpcaoProdutoKitManual = {
  id: string; sku: string; imagem_url: string | null;
  componentes_kit?: { sku: string; quantidade: number }[];
};

export function montarOpcoesKitsManuais(
  produtos: readonly OpcaoProdutoKitManual[],
  componentes: readonly { kitSku: string; sku: string; quantidade: number }[],
): OpcaoProdutoKitManual[] {
  const porKit = new Map<string, { sku: string; quantidade: number }[]>();
  for (const item of componentes) {
    const lista = porKit.get(item.kitSku) ?? [];
    lista.push({ sku: item.sku, quantidade: item.quantidade }); porKit.set(item.kitSku, lista);
  }
  const opcoes = produtos.map((produto) => ({ ...produto, componentes_kit: porKit.get(produto.sku) }));
  const cadastrados = new Set(produtos.map((produto) => produto.sku));
  for (const [sku, composicao] of porKit) {
    if (!cadastrados.has(sku)) opcoes.push({ id: `kit:${sku}`, sku, imagem_url: null, componentes_kit: composicao });
  }
  return opcoes.sort((a, b) => a.sku.localeCompare(b.sku));
}

export function expandirKitProducaoManual(
  produto: OpcaoProdutoKitManual, quantidade: string,
  produtos: readonly OpcaoProdutoKitManual[],
) {
  if (!produto.componentes_kit?.length) return null;
  const expandidos = expandirItemKit({ sku: produto.sku, quantidade: Number(quantidade) }, produto.componentes_kit);
  return expandidos.map((item) => {
    const componente = produtos.find((opcao) => opcao.sku === item.sku && !opcao.componentes_kit?.length);
    if (!componente) throw new Error(`Componente ${item.sku} do kit ${produto.sku} não está disponível como produto individual ativo. Atualize o cadastro e recarregue a página.`);
    return { produto: componente, quantidade: item.quantidade };
  });
}
