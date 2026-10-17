import { montarPedidoFornecedor, ErroMontagemFornecedor } from "@/lib/pedido-fornecedor-montagem";
import { NextResponse } from "next/server";
import { enviarFornecedor, ErroEnvioFornecedor } from "@/lib/envio-fornecedor";
import {
  extrairTamanhoSku,
  extrairTipoProdutoSku,
} from "@/lib/olist-pedido";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const ESTAMPA_VARIANTE_REGEX = /(?:^|-)EST\/([^\/-]+)-([^\/]+)(?:\/|$)/i;

function extrairEstampaVariante(sku: string) {
  const match = sku.match(ESTAMPA_VARIANTE_REGEX);
  return match ? { estampa: match[1], variante: match[2] } : { estampa: "", variante: "" };
}

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, aplicativoId: true },
    });
    if (!solicitante?.podeSolicitarProducao) throw new ErroEnvioFornecedor("Sem permissão para enviar solicitações.");

    const body = await request.json() as {
      fornecedorId?: unknown;
      solicitacaoId?: unknown;
      acao?: unknown;
      pedidoEditado?: unknown;
    };
    const fornecedorId = String(body.fornecedorId ?? "");
    const solicitacaoId = String(body.solicitacaoId ?? "");
    if (!fornecedorId || !solicitacaoId) throw new ErroEnvioFornecedor("Fornecedor e solicitação são obrigatórios.");

    const fornecedor = await prisma.fornecedor.findFirst({ where: { id: fornecedorId, aplicativoId: solicitante.aplicativoId } });
    if (!fornecedor?.vendedorOlistId) throw new ErroEnvioFornecedor("Fornecedor sem usuário vendedor vinculado.");
    if (!fornecedor.meuClienteOlistId) throw new ErroEnvioFornecedor("Fornecedor sem Meu ID de cliente cadastrado.");
    if (!fornecedor.meuFormaPagamentoOlistId) throw new ErroEnvioFornecedor("Fornecedor sem forma de pagamento Olist cadastrada.");
    if (!fornecedor.meuPlanoPagamentoId) throw new ErroEnvioFornecedor("Fornecedor sem plano de pagamento cadastrado.");

    const vendedor = await prisma.usuario.findUnique({
      where: { id: String(fornecedor.vendedorOlistId) },
      select: { ativo: true, aplicativoId: true, vendedorOlistId: true },
    });
    if (!vendedor?.ativo || !vendedor.vendedorOlistId) {
      throw new ErroEnvioFornecedor("O usuário vendedor está inativo ou não possui ID de vendedor Olist.");
    }

    const associacaoPagamento = await prisma.formaPagamentoOlistPlano.findFirst({
      where: {
        aplicativoId: vendedor.aplicativoId,
        formaOlistId: String(fornecedor.meuFormaPagamentoOlistId),
        planoPagamentoId: fornecedor.meuPlanoPagamentoId,
        planoPagamento: { ativo: true },
      },
      select: { planoPagamento: { select: { nome: true } } },
    });
    if (!associacaoPagamento) {
      throw new ErroEnvioFornecedor("O plano cadastrado no fornecedor não está associado à forma de pagamento selecionada.");
    }

    const solicitacao = await prisma.solicitacaoProducao.findFirst({
      where: { id: solicitacaoId, aplicativoId: solicitante.aplicativoId, status: "em_producao" },
    });
    if (!solicitacao) throw new ErroEnvioFornecedor("Solicitação em produção não encontrada neste aplicativo.");

    const envioExistente = await prisma.pedidoFornecedorSolicitacao.findFirst({
      where: { solicitacaoId },
      select: { id: true },
    });
    if (envioExistente) throw new ErroEnvioFornecedor("Esta solicitação já foi enviada para o fornecedor.");

    const itensSolicitacao = await prisma.itemSolicitacaoProducao.findMany({
      where: { solicitacaoId, aplicativoId: solicitante.aplicativoId },
      orderBy: { sku: "asc" },
    });
    if (itensSolicitacao.length === 0) throw new ErroEnvioFornecedor("A solicitação não possui produtos.");

    const associacoes = await prisma.produtoOlistProdutoFornecedor.findMany({
      where: { produtoId: { in: itensSolicitacao.map((item) => item.produtoId) }, produtoFornecedor: { fornecedorId, aplicativoId: solicitante.aplicativoId } },
      include: { produtoFornecedor: true },
    });
    const associacaoPorProduto = new Map(associacoes.map((item) => [item.produtoId, item]));
    const linhas = itensSolicitacao.map((item) => {
      const associacao = associacaoPorProduto.get(item.produtoId);
      if (!associacao?.produtoFornecedor.referencia) throw new ErroEnvioFornecedor(`Produto ${item.sku} sem referência de produto fornecido.`);
      const { estampa, variante } = extrairEstampaVariante(item.sku);
      return { referencia: associacao.produtoFornecedor.referencia.trim(), nome: associacao.produtoFornecedor.nome,
        preco: Number(associacao.produtoFornecedor.precoUnitarioMetro), quantidade: item.quantidadeSolicitada * Number(associacao.quantidadeUsada),
        quantidadeSolicitada: item.quantidadeSolicitada, sku: item.sku, estampa, variante, laser: item.tipoCorte === "LASER",
        tamanho: extrairTamanhoSku(item.sku), tipo: extrairTipoProdutoSku(item.sku) };
    });
    const servico = linhas.some((item) => item.laser) ? await prisma.produtoFornecedor.findFirst({
      where: { aplicativoId: solicitante.aplicativoId, fornecedorId, tipoServico: "CORTE_LASER" },
    }) : null;
    const pedidoGerado = montarPedidoFornecedor(linhas, {
      clienteId: fornecedor.meuClienteOlistId, vendedorId: vendedor.vendedorOlistId,
      formaId: fornecedor.meuFormaPagamentoOlistId, plano: associacaoPagamento.planoPagamento.nome,
      tipoVenda: fornecedor.meuTipoVenda, observacao: solicitacao.observacaoGeral,
    }, servico ? { referencia: servico.referencia, preco: Number(servico.precoUnitarioMetro) } : null);

    if (body.acao === "preview") {
      return NextResponse.json({ pedido: pedidoGerado });
    }

    const pedido = body.pedidoEditado && typeof body.pedidoEditado === "object" && !Array.isArray(body.pedidoEditado)
      ? body.pedidoEditado as Record<string, unknown>
      : pedidoGerado;
    const resultado = await enviarFornecedor({ solicitacaoId, fornecedorId, aplicativoId: vendedor.aplicativoId,
      usuarioId: autenticado.id, payload: pedido });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ErroEnvioFornecedor || error instanceof ErroMontagemFornecedor ? error.message : "Não foi possível enviar o pedido. Verifique os dados e a integração Olist." },
      { status: 400 },
    );
  }
}
