import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { obterDataAtualizacaoPadrao } from "@/lib/olist-filtro-data";
import {
  RetornoOlistError, normalizarItensRetorno, revisarBaixaRetorno, validarPedidoCancelado,
  type ConfirmarRetornoInput, type PedidoRetornoRevisao, type ResultadoBuscaRetorno,
} from "@/lib/retorno-estoque-olist-domain";

type OlistRetorno = {
  listarCancelados(aplicativoId: string, desde: Date): Promise<{ id: string | number }[]>;
  obterPedido(aplicativoId: string, pedidoId: string): Promise<Record<string, unknown>>;
};
const incluirRetornos = { retornos: { select: { quantidade: true } } } as const;

export function criarServicoRetornoOlist(db: PrismaClient, olist: OlistRetorno) {
  async function buscar(aplicativoId: string, data?: string): Promise<ResultadoBuscaRetorno> {
    const desde = data ? new Date(`${data}T00:00:00.000Z`) : obterDataAtualizacaoPadrao();
    let listados: { id: string | number }[];
    try { listados = await olist.listarCancelados(aplicativoId, desde); }
    catch { throw new RetornoOlistError("Não foi possível concluir a consulta Olist. Tente novamente; nenhum estoque foi alterado.", 502); }
    const ids = [...new Set(listados.map((pedido) => String(pedido.id)))];
    const baixas = await db.itemBaixaEstoqueOlist.findMany({
      where: { aplicativoId, pedidoOlistId: { in: ids } }, include: incluirRetornos,
    });
    const saidas = await db.movimentacaoEstoque.findMany({ where: {
      aplicativoId, id: { in: baixas.flatMap((baixa) => baixa.movimentacaoId ? [baixa.movimentacaoId] : []) },
    } });
    const produtos = await db.produto.findMany({ where: {
      aplicativoId, id: { in: baixas.flatMap((baixa) => baixa.produtoId ? [baixa.produtoId] : []) },
    }, select: { id: true, sku: true } });
    const saidaPorId = new Map(saidas.map((saida) => [saida.id, saida]));
    const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));
    const baixasPorPedido = new Map<string, typeof baixas>();
    for (const baixa of baixas) {
      const pedidoId = baixa.pedidoOlistId!;
      const grupo = baixasPorPedido.get(pedidoId) ?? [];
      grupo.push(baixa);
      baixasPorPedido.set(pedidoId, grupo);
    }
    const pedidos: PedidoRetornoRevisao[] = [];
    for (const id of ids) {
      const vinculadas = baixasPorPedido.get(id) ?? [];
      if (!vinculadas.length) { pedidos.push({ id, estado: "sem_baixa", itens: [] }); continue; }
      try {
        const itens = vinculadas.map((baixa) => {
          if (!baixa.produtoId || produtoPorId.get(baixa.produtoId)?.sku !== baixa.sku) {
            throw new RetornoOlistError("Produto da baixa não está disponível neste aplicativo.", 409);
          }
          return revisarBaixaRetorno(baixa, saidaPorId.get(baixa.movimentacaoId ?? ""), aplicativoId);
        });
        if (!itens.some((item) => item.saldo > 0)) { pedidos.push({ id, estado: "retornado", itens }); continue; }
        let detalhe: Record<string, unknown>;
        try { detalhe = await olist.obterPedido(aplicativoId, id); }
        catch { throw new RetornoOlistError("Consulta de detalhe pendente na Olist. Busque novamente para revisar este pedido.", 502); }
        validarPedidoCancelado(detalhe, itens.map((item) => item.sku));
        pedidos.push({ id, estado: "elegivel", itens });
      } catch (error) {
        if (!(error instanceof RetornoOlistError)) throw error;
        pedidos.push({ id, estado: "pendente", motivo: error.message, itens: [] });
      }
    }
    return { data_atualizacao: desde.toISOString().slice(0, 10), pedidos };
  }

  async function confirmar(aplicativoId: string, usuarioId: string, input: ConfirmarRetornoInput) {
    const itens = normalizarItensRetorno(input);
    const hash = createHash("sha256").update(JSON.stringify(itens)).digest("hex");
    const where = { aplicativoId_chaveIdempotencia: { aplicativoId, chaveIdempotencia: input.chave_idempotencia } };
    function resultado(retorno: { id: string; payloadHash: string; itens: { quantidade: number }[] }) {
      if (retorno.payloadHash !== hash) throw new RetornoOlistError("Chave de confirmação já utilizada com outros itens ou quantidades.", 409);
      return { retorno_id: retorno.id, itens: retorno.itens.length,
        quantidade: retorno.itens.reduce((total, item) => total + item.quantidade, 0) };
    }
    const anterior = await db.retornoEstoqueOlist.findUnique({ where, include: { itens: true } });
    if (anterior) return resultado(anterior);
    const ids = itens.map((item) => item.item_baixa_id);
    const baixas = await db.itemBaixaEstoqueOlist.findMany({ where: { aplicativoId, id: { in: ids } } });
    if (baixas.length !== ids.length) throw new RetornoOlistError("Baixa não encontrada neste aplicativo.", 404);
    const pedidos = [...new Set(baixas.map((baixa) => baixa.pedidoOlistId))];
    for (const pedidoId of pedidos) {
      if (!pedidoId) throw new RetornoOlistError("Baixa sem pedido vinculado.", 409);
      let detalhe: Record<string, unknown>;
      try { detalhe = await olist.obterPedido(aplicativoId, pedidoId); }
      catch { throw new RetornoOlistError("Não foi possível revalidar o cancelamento na Olist. Nenhum retorno foi registrado.", 502); }
      validarPedidoCancelado(detalhe, baixas.filter((baixa) => baixa.pedidoOlistId === pedidoId).map((baixa) => baixa.sku));
    }
    return db.$transaction(async (tx) => {
      // Serializa reenvios da mesma chave, inclusive quando os conjuntos de baixas diferem.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${aplicativoId}:${input.chave_idempotencia}`}, 0))::text`;
      const existente = await tx.retornoEstoqueOlist.findUnique({ where, include: { itens: true } });
      if (existente) return resultado(existente);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM public.itens_baixa_estoque_olist
        WHERE aplicativo_id = ${aplicativoId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR UPDATE`);
      const atuais = await tx.itemBaixaEstoqueOlist.findMany({
        where: { aplicativoId, id: { in: ids } }, include: incluirRetornos,
      });
      if (atuais.length !== ids.length) throw new RetornoOlistError("Baixa não encontrada neste aplicativo.", 404);
      const retorno = await tx.retornoEstoqueOlist.create({ data: {
        aplicativoId, usuarioId, chaveIdempotencia: input.chave_idempotencia, payloadHash: hash,
      } });
      for (const item of itens) {
        const baixa = atuais.find((atual) => atual.id === item.item_baixa_id)!;
        const previa = baixas.find((anterior) => anterior.id === baixa.id)!;
        if (baixa.pedidoOlistId !== previa.pedidoOlistId || baixa.sku !== previa.sku) {
          throw new RetornoOlistError("Baixa alterada durante a confirmação. Busque novamente.", 409);
        }
        const saida = baixa.movimentacaoId ? await tx.movimentacaoEstoque.findFirst({
          where: { id: baixa.movimentacaoId, aplicativoId },
        }) : null;
        const revisao = revisarBaixaRetorno(baixa, saida ?? undefined, aplicativoId);
        if (item.quantidade > revisao.saldo) throw new RetornoOlistError(`Quantidade acima do saldo disponível para ${baixa.sku}. Busque novamente.`, 409);
        const produto = await tx.produto.findFirst({ where: { id: baixa.produtoId!, aplicativoId, sku: baixa.sku }, select: { id: true } });
        if (!produto) throw new RetornoOlistError("Produto da baixa não está disponível neste aplicativo.", 409);
        const movimento = await tx.movimentacaoEstoque.create({ data: {
          aplicativoId, produtoId: produto.id, sku: baixa.sku, tipoMovimento: "entrada", quantidade: item.quantidade,
          origem: "RETORNO_CANCELAMENTO_OLIST", referenciaId: retorno.id,
          observacao: `Retorno do pedido cancelado Olist ${baixa.pedidoOlistId}`,
        } });
        await tx.itemRetornoEstoqueOlist.create({ data: { aplicativoId, retornoId: retorno.id,
          itemBaixaId: baixa.id, movimentacaoId: movimento.id, quantidade: item.quantidade } });
      }
      return { retorno_id: retorno.id, itens: itens.length, quantidade: itens.reduce((total, item) => total + item.quantidade, 0) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
  }

  async function historico(aplicativoId: string, pagina: number) {
    const registros = await db.retornoEstoqueOlist.findMany({ where: { aplicativoId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (pagina - 1) * 20, take: 21,
      include: { usuario: { select: { nome: true } }, itens: { include: { itemBaixa: { select: { pedidoOlistId: true, sku: true } } } } },
    });
    return { tem_mais: registros.length > 20, retornos: registros.slice(0, 20).map((retorno) => ({
      id: retorno.id, created_at: retorno.createdAt.toISOString(), responsavel: retorno.usuario.nome,
      itens: retorno.itens.map((item) => ({ pedido_olist_id: item.itemBaixa.pedidoOlistId, sku: item.itemBaixa.sku, quantidade: item.quantidade })),
    })) };
  }
  return { buscar, confirmar, historico };
}
