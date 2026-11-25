import { prisma } from "@/lib/prisma";
import { listarProdutosOlistApi, obterAnexosProdutoOlistApi } from "@/lib/olist";
import { DetalheProducaoError } from "@/lib/producao-detalhes-contrato";

export function urlImagemProduto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  try {
    const url = new URL(valor);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (/\.(pdf|zip|rar|docx?|xlsx?|txt|csv|mp4|mov)$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

// Agrupa cliques simultâneos e limita novas consultas por item a cada 30 segundos nesta instância.
const consultas = new Map<string, { ate: number; promessa: Promise<string | null> }>();

export async function carregarImagemItemProducao(aplicativoId: string, solicitacaoId: string, itemId: string, imagemInvalida?: string | null) {
  const solicitacao = await prisma.solicitacaoProducao.findFirst({ where: { id: solicitacaoId, aplicativoId }, select: { id: true } });
  if (!solicitacao) throw new DetalheProducaoError("Produção não encontrada.", 404);
  const item = await prisma.itemSolicitacaoProducao.findFirst({
    where: { id: itemId, solicitacaoId, aplicativoId }, select: { id: true, produtoId: true, sku: true, imagemUrl: true },
  });
  if (!item) throw new DetalheProducaoError("Item não encontrado nesta produção.", 404);
  const existente = urlImagemProduto(item.imagemUrl);
  if (existente && existente !== imagemInvalida) return existente;
  const chave = `${aplicativoId}:${solicitacaoId}:${itemId}:${existente === imagemInvalida ? existente : ""}`;
  const atual = consultas.get(chave);
  if (atual && atual.ate > Date.now()) return atual.promessa;
  for (const [key, consulta] of consultas) if (consulta.ate <= Date.now()) consultas.delete(key);
  if (consultas.size >= 1000) throw new DetalheProducaoError("Aguarde e tente carregar a imagem novamente.", 429);
  const promessa = (async () => {
    const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, aplicativoId, sku: item.sku }, select: { idCadastroOlist: true } });
    if (!produto) throw new DetalheProducaoError("Produto não encontrado nesta empresa.", 404);
    let idOlist = produto.idCadastroOlist;
    if (!idOlist || !/^\d+$/.test(idOlist)) {
      const lista = await listarProdutosOlistApi(aplicativoId, { codigo: item.sku, limit: 100, offset: 0, validarContrato: true });
      const encontrados = lista.itens.filter((produto) => produto.sku === item.sku);
      if (encontrados.length !== 1) return null;
      idOlist = String(encontrados[0].id);
    }
    const anexos = await obterAnexosProdutoOlistApi(aplicativoId, idOlist);
    const imagemUrl = anexos.map((anexo) => urlImagemProduto(anexo?.url)).find((url) => url && url !== imagemInvalida) ?? null;
    if (!imagemUrl) return null;
    await prisma.itemSolicitacaoProducao.updateMany({
      where: { id: itemId, solicitacaoId, aplicativoId, imagemUrl: item.imagemUrl }, data: { imagemUrl },
    });
    return imagemUrl;
  })();
  consultas.set(chave, { ate: Date.now() + 30_000, promessa });
  return promessa;
}

export async function lerImagemInvalida(request: Request): Promise<string | null> {
  if (!request.body) return null;
  let body: unknown;
  try { body = await request.json(); } catch { throw new DetalheProducaoError("Dados de imagem inválidos.", 400); }
  if (!body || typeof body !== "object" || !("imagemInvalida" in body) || Object.keys(body).some((key) => key !== "imagemInvalida")) throw new DetalheProducaoError("Dados de imagem inválidos.", 400);
  const valor = body.imagemInvalida;
  const url = typeof valor === "string" && valor.length <= 4096 ? urlImagemProduto(valor) : null;
  if (!url) throw new DetalheProducaoError("URL de imagem inválida.", 400);
  return url;
}
