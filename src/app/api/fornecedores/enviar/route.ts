import { NextResponse } from "next/server";
import { criarPedidoOlistApi } from "@/lib/olist";
import {
  criarInfoAdicionalOlist,
  criarObservacoesPedidoOlist,
  extrairTamanhoSku,
  extrairTipoProdutoSku,
  type LinhaObservacaoPedidoOlist,
} from "@/lib/olist-pedido";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const ESTAMPA_VARIANTE_REGEX = /(?:^|-)EST\/([^\/-]+)-([^\/]+)(?:\/|$)/i;

function extrairEstampaVariante(sku: string) {
  const match = sku.match(ESTAMPA_VARIANTE_REGEX);
  return match ? { estampa: match[1], variante: match[2] } : { estampa: "", variante: "" };
}

function formatarQuantidadeDivisao(quantidade: number) {
  return quantidade.toFixed(2).replace(".", ",");
}

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, aplicativoId: true },
    });
    if (!solicitante?.podeSolicitarProducao) throw new Error("Sem permissão para enviar solicitações.");

    const body = await request.json() as {
      fornecedorId?: unknown;
      solicitacaoId?: unknown;
      acao?: unknown;
      pedidoEditado?: unknown;
    };
    const fornecedorId = String(body.fornecedorId ?? "");
    const solicitacaoId = String(body.solicitacaoId ?? "");
    if (!fornecedorId || !solicitacaoId) throw new Error("Fornecedor e solicitação são obrigatórios.");

    const fornecedor = await prisma.fornecedor.findUnique({ where: { id: fornecedorId } });
    if (!fornecedor?.vendedorOlistId) throw new Error("Fornecedor sem usuário vendedor vinculado.");
    if (!fornecedor.meuClienteOlistId) throw new Error("Fornecedor sem Meu ID de cliente cadastrado.");

    const vendedor = await prisma.usuario.findUnique({
      where: { id: String(fornecedor.vendedorOlistId) },
      select: { ativo: true, aplicativoId: true, vendedorOlistId: true },
    });
    if (!vendedor?.ativo || !vendedor.vendedorOlistId) {
      throw new Error("O usuário vendedor está inativo ou não possui ID de vendedor Olist.");
    }

    const solicitacao = await prisma.solicitacaoProducao.findFirst({
      where: { id: solicitacaoId, aplicativoId: solicitante.aplicativoId, status: "em_producao" },
    });
    if (!solicitacao) throw new Error("Solicitação em produção não encontrada neste aplicativo.");

    const envioExistente = await prisma.pedidoFornecedorSolicitacao.findFirst({
      where: { solicitacaoId },
      select: { id: true },
    });
    if (envioExistente) throw new Error("Esta solicitação já foi enviada para o fornecedor.");

    const itensSolicitacao = await prisma.itemSolicitacaoProducao.findMany({
      where: { solicitacaoId, aplicativoId: solicitante.aplicativoId },
      orderBy: { sku: "asc" },
    });
    if (itensSolicitacao.length === 0) throw new Error("A solicitação não possui produtos.");

    const associacoes = await prisma.produtoOlistProdutoFornecedor.findMany({
      where: { produtoId: { in: itensSolicitacao.map((item) => item.produtoId) } },
      include: { produtoFornecedor: true },
    });
    const associacaoPorProduto = new Map(associacoes.map((item) => [item.produtoId, item]));
    let quantidadeCorteLaser = 0;
    const grupos = new Map<string, {
      referencia: string;
      nome: string;
      preco: number;
      quantidade: number;
      divisoes: Map<string, {
        estampa: string; variante: string; quantidade: number; laser: boolean; tamanho: string; tipo: string;
      }>;
    }>();

    for (const item of itensSolicitacao) {
      const associacao = associacaoPorProduto.get(item.produtoId);
      const referencia = associacao?.produtoFornecedor.referencia?.trim();
      if (!associacao || !referencia) throw new Error(`Produto ${item.sku} sem referência de produto fornecido.`);
      const consumo = Number(associacao.quantidadeUsada);
      const preco = Number(associacao.produtoFornecedor.precoUnitarioMetro);
      const quantidade = item.quantidadeSolicitada * consumo;
      if (!Number.isFinite(quantidade) || quantidade <= 0) throw new Error(`Quantidade fornecida inválida para ${item.sku}.`);
      if (!Number.isFinite(preco) || preco < 0) throw new Error(`Preço inválido no produto fornecido ${referencia}.`);
      const { estampa, variante } = extrairEstampaVariante(item.sku);
      const laser = item.tipoCorte === "LASER";
      if (laser) quantidadeCorteLaser += quantidade;
      const tamanho = extrairTamanhoSku(item.sku);
      const tipo = extrairTipoProdutoSku(item.sku);
      const chaveGrupo = `${referencia}\u0000${laser}`;
      const grupo = grupos.get(chaveGrupo) ?? {
        referencia,
        nome: associacao.produtoFornecedor.nome,
        preco,
        quantidade: 0,
        divisoes: new Map(),
      };
      grupo.quantidade += quantidade;
      const chave = `${item.sku}\u0000${estampa}\u0000${variante}\u0000${laser}\u0000${tamanho}\u0000${tipo}`;
      const divisao = grupo.divisoes.get(chave) ?? { estampa, variante, quantidade: 0, laser, tamanho, tipo };
      divisao.quantidade += item.quantidadeSolicitada;
      grupo.divisoes.set(chave, divisao);
      grupos.set(chaveGrupo, grupo);
    }

    const itens = [];
    const observacoes: LinhaObservacaoPedidoOlist[] = [];
    for (const grupo of grupos.values()) {
      const produtoId = Number(grupo.referencia);
      if (!Number.isInteger(produtoId) || produtoId <= 0) throw new Error(`ID inválido para a referência ${grupo.referencia}.`);
      const divisoes = Array.from(grupo.divisoes.values());
      const infoAdicional = criarInfoAdicionalOlist(
        divisoes.map((divisao) => ({
          ...divisao,
          quantidade: formatarQuantidadeDivisao(divisao.quantidade),
          unidade: divisao.laser ? "UN" : "MT",
        })),
        "MT",
        { incluirTagsVazias: true },
      );
      for (const divisao of divisoes) {
        observacoes.push({
          descricao: grupo.nome,
          quantidade: formatarQuantidadeDivisao(divisao.quantidade),
          unidade: divisao.laser ? "UN" : "MT",
          estampa: divisao.estampa,
          variante: divisao.variante,
          laser: divisao.laser,
          tamanho: divisao.tamanho,
          tipo: divisao.tipo,
        });
      }
      itens.push({
        produto: { id: produtoId, tipo: "P" },
        quantidade: Number(grupo.quantidade.toFixed(2)),
        valorUnitario: grupo.preco,
        infoAdicional,
      });
    }

    if (quantidadeCorteLaser > 0) {
      const servicoCorteLaser = await prisma.produtoFornecedor.findFirst({
        where: {
          aplicativoId: solicitante.aplicativoId,
          fornecedorId,
          tipoServico: "CORTE_LASER",
        },
        select: {
          referencia: true,
          precoUnitarioMetro: true,
        },
      });
      if (!servicoCorteLaser) {
        throw new Error("Fornecedor sem produto de serviço Corte a laser cadastrado.");
      }

      const servicoId = Number(servicoCorteLaser.referencia?.trim());
      if (!Number.isInteger(servicoId) || servicoId <= 0) {
        throw new Error("O serviço Corte a laser deve possuir uma referência com o ID numérico da Olist.");
      }

      const precoServico = Number(servicoCorteLaser.precoUnitarioMetro);
      if (!Number.isFinite(precoServico) || precoServico < 0) {
        throw new Error("Preço inválido no serviço Corte a laser.");
      }

      itens.push({
        produto: { id: servicoId, tipo: "S" },
        quantidade: Number(quantidadeCorteLaser.toFixed(2)),
        valorUnitario: precoServico,
        infoAdicional: "",
      });
    }

    const pedidoGerado = {
      idContato: fornecedor.meuClienteOlistId,
      vendedor: { id: vendedor.vendedorOlistId },
      situacao: 0,
      data: new Date().toISOString().slice(0, 10),
      observacoes: criarObservacoesPedidoOlist(observacoes),
      itens,
    };

    if (body.acao === "preview") {
      return NextResponse.json({ pedido: pedidoGerado });
    }

    const pedido = body.pedidoEditado && typeof body.pedidoEditado === "object" && !Array.isArray(body.pedidoEditado)
      ? body.pedidoEditado as Record<string, unknown>
      : pedidoGerado;
    const resultado = await criarPedidoOlistApi(vendedor.aplicativoId, pedido);
    const pedidoOlistId = String(resultado.id ?? "").trim();
    if (!pedidoOlistId) throw new Error("A Olist criou o pedido, mas não retornou o ID para registro.");

    const registro = await prisma.pedidoFornecedorSolicitacao.create({
      data: {
        pedidoOlistId,
        fornecedorId: fornecedor.id,
        solicitacaoId: solicitacao.id,
      },
      select: { id: true },
    });

    return NextResponse.json({ ...resultado, registroId: registro.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao enviar pedido ao fornecedor." },
      { status: 400 },
    );
  }
}
