import { Prisma } from "@prisma/client";
import { DetalheProducaoError } from "./producao-detalhes-contrato";
import { revisaoItensProducao } from "./producao-revisao";
import { calcularAjustesEstoqueProducao, ORIGENS_ESTOQUE_PRODUCAO, saldoMovimentacoesProducao } from "./producao-ajustes-estoque";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ItemEdicao = { id: string | null; produtoId: string; quantidadeSolicitada: number; quantidadeProduzida: number };

export function normalizarEdicaoItensProducao(body: unknown) {
  const dados = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (typeof dados.revisao !== "string" || !/^[a-f0-9]{64}$/.test(dados.revisao)) {
    throw new DetalheProducaoError("Recarregue a produção antes de editar.", 400);
  }
  if (!Array.isArray(dados.itens) || dados.itens.length < 1 || dados.itens.length > 500) {
    throw new DetalheProducaoError("Informe entre 1 e 500 itens.", 400);
  }
  const itens: ItemEdicao[] = dados.itens.map((valor: unknown) => {
    const item = valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
    const id = item.id === null || item.id === undefined ? null : item.id;
    if ((id !== null && (typeof id !== "string" || !UUID.test(id))) || typeof item.produtoId !== "string" || !UUID.test(item.produtoId)) {
      throw new DetalheProducaoError("Item ou produto inválido.", 400);
    }
    for (const campo of ["quantidadeSolicitada", "quantidadeProduzida"]) {
      if (typeof item[campo] !== "number" || !Number.isSafeInteger(item[campo]) || item[campo] < 0 || item[campo] > 2_147_483_647) {
        throw new DetalheProducaoError("Informe quantidades inteiras entre 0 e 2147483647.", 400);
      }
    }
    return { id, produtoId: item.produtoId, quantidadeSolicitada: item.quantidadeSolicitada as number, quantidadeProduzida: item.quantidadeProduzida as number };
  });
  const ids = itens.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(ids).size !== ids.length) throw new DetalheProducaoError("Existem itens duplicados na edição.", 400);
  return { revisao: dados.revisao, itens };
}

export async function editarItensProducao(input: ReturnType<typeof normalizarEdicaoItensProducao> & { solicitacaoId: string; aplicativoId: string; usuarioId: string }) {
  const { prisma } = await import("./prisma");
  try {
    return await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacaoProducao.findFirst({
        where: { id: input.solicitacaoId, aplicativoId: input.aplicativoId }, select: { id: true, status: true },
      });
      if (!solicitacao) throw new DetalheProducaoError("Produção não encontrada.", 404);
      const atuais = await tx.itemSolicitacaoProducao.findMany({
        where: { solicitacaoId: input.solicitacaoId, aplicativoId: input.aplicativoId },
        select: { id: true, produtoId: true, sku: true, imagemUrl: true, quantidadeSolicitada: true, quantidadeProduzida: true, tipoCorte: true, observacao: true },
      });
      if (revisaoItensProducao(solicitacao.status, atuais) !== input.revisao) {
        throw new DetalheProducaoError("A produção foi alterada por outro usuário. Recarregue os detalhes antes de salvar.", 409);
      }
      const porId = new Map(atuais.map((item) => [item.id, item]));
      for (const item of input.itens) {
        if (item.id && porId.get(item.id)?.produtoId !== item.produtoId) {
          throw new DetalheProducaoError("Um item não pertence a esta produção. Para trocar o produto, remova o item e adicione outro.", 400);
        }
      }
      const novos = input.itens.filter((item) => !item.id);
      const produtos = novos.length ? await tx.produto.findMany({
        where: { id: { in: novos.map((item) => item.produtoId) }, aplicativoId: input.aplicativoId, ativo: true },
        select: { id: true, sku: true, imagemUrl: true },
      }) : [];
      const porProduto = new Map(produtos.map((produto) => [produto.id, produto]));
      if (novos.some((item) => !porProduto.has(item.produtoId))) {
        throw new DetalheProducaoError("Um produto adicionado está inativo ou não pertence a este aplicativo.", 400);
      }
      let movimentosCriados = 0;
      if (solicitacao.status === "concluida") {
        const movimentos = await tx.movimentacaoEstoque.findMany({
          where: { aplicativoId: input.aplicativoId, referenciaId: input.solicitacaoId, origem: { in: ORIGENS_ESTOQUE_PRODUCAO } },
          select: { produtoId: true, sku: true, quantidade: true, tipoMovimento: true },
        });
        const desejado = input.itens.map((item) => ({
          produtoId: item.produtoId,
          sku: item.id ? porId.get(item.id)!.sku : porProduto.get(item.produtoId)!.sku,
          quantidade: item.quantidadeProduzida,
        }));
        const ajustes = calcularAjustesEstoqueProducao(saldoMovimentacoesProducao(movimentos), desejado);
        if (ajustes.length) await tx.movimentacaoEstoque.createMany({ data: ajustes.map((ajuste) => ({
          ...ajuste, origem: "AJUSTE_PRODUCAO", referenciaId: input.solicitacaoId, aplicativoId: input.aplicativoId,
          observacao: `Correção dos itens produzidos na tela de detalhes. Usuário: ${input.usuarioId}`,
        })) });
        movimentosCriados = ajustes.length;
      }
      const mantidos = input.itens.flatMap((item) => item.id ? [item.id] : []);
      await tx.itemSolicitacaoProducao.deleteMany({ where: { solicitacaoId: input.solicitacaoId, aplicativoId: input.aplicativoId, id: { notIn: mantidos } } });
      for (const item of input.itens) {
        if (item.id) {
          const anterior = porId.get(item.id)!;
          if (anterior.quantidadeSolicitada !== item.quantidadeSolicitada || anterior.quantidadeProduzida !== item.quantidadeProduzida) {
            await tx.itemSolicitacaoProducao.update({ where: { id: item.id }, data: { quantidadeSolicitada: item.quantidadeSolicitada, quantidadeProduzida: item.quantidadeProduzida } });
          }
        } else {
          const produto = porProduto.get(item.produtoId)!;
          await tx.itemSolicitacaoProducao.create({ data: {
            solicitacaoId: input.solicitacaoId, aplicativoId: input.aplicativoId, produtoId: produto.id, sku: produto.sku,
            imagemUrl: produto.imagemUrl, quantidadeSolicitada: item.quantidadeSolicitada, quantidadeProduzida: item.quantidadeProduzida,
            statusItem: solicitacao.status,
          } });
        }
      }
      return { movimentosCriados };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new DetalheProducaoError("A produção foi alterada durante o salvamento. Recarregue os detalhes antes de tentar novamente.", 409);
    }
    throw error;
  }
}
