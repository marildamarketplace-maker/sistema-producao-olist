import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { montarOpcoesKitsManuais } from "@/lib/producao-manual-kits";

// O aplicativo e a inclusão de kits integram a chave; autorização fica na rota.
export const carregarOpcoesProdutos = unstable_cache(async (aplicativoId: string, incluirKits: boolean) => {
    const [produtos, tiposProduto, tamanhos] = await Promise.all([
      prisma.produto.findMany({
        where: { aplicativoId: aplicativoId, ativo: true },
        orderBy: { sku: "asc" },
        select: { id: true, sku: true, imagemUrl: true },
      }),
      prisma.tipoProduto.findMany({
        orderBy: { titulo: "asc" },
        select: { id: true, sku: true, titulo: true },
      }),
      prisma.tamanho.findMany({
        orderBy: { titulo: "asc" },
        select: { id: true, sku: true, titulo: true },
      }),
    ]);

    const produtosBase = produtos.map((produto) => ({
      id: produto.id, sku: produto.sku, imagem_url: produto.imagemUrl,
    }));
    const composicoes = incluirKits ? await prisma.componenteKitEstoque.findMany({
      where: { aplicativoId: aplicativoId },
      select: { kitSku: true, sku: true, quantidade: true },
    }) : [];
    return {
      produtos: incluirKits ? montarOpcoesKitsManuais(produtosBase, composicoes) : produtos.map((produto) => ({
        id: produto.id,
        sku: produto.sku,
        imagem_url: produto.imagemUrl,
      })),
      tiposProduto: tiposProduto.map((tipo) => ({
        id: tipo.id,
        codigo: tipo.sku,
        nome: tipo.titulo,
      })),
      tamanhos: tamanhos.map((tamanho) => ({
        id: tamanho.id,
        codigo: tamanho.sku,
        descricao: tamanho.titulo,
      })),
    };
}, ["produtos-opcoes", "completo-v1"], { revalidate: 60 });

export const carregarOpcoesProdutosEdicao = unstable_cache(async (aplicativoId: string) => ({
  produtos: await prisma.produto.findMany({
    where: { aplicativoId, ativo: true }, orderBy: [{ sku: "asc" }, { id: "asc" }],
    select: { id: true, sku: true },
  }),
}), ["produtos-opcoes", "edicao-v1"], { revalidate: 60 });
