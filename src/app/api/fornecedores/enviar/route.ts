import { NextResponse } from "next/server";
import { criarPedidoOlistApi, listarProdutosOlistApi, obterProdutoOlistApi } from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const ESTAMPA_VARIANTE_REGEX = /(?:^|-)EST\/([^\/-]+)-([^\/]+)(?:\/|$)/i;

function escaparXml(valor: string) {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numeroDecimal(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function precoProduto(produto: Record<string, unknown>) {
  const precos = produto.precos && typeof produto.precos === "object"
    ? produto.precos as Record<string, unknown>
    : {};
  return numeroDecimal(precos.precoPromocional) ?? numeroDecimal(precos.preco);
}

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, aplicativoId: true },
    });
    if (!solicitante?.podeSolicitarProducao) throw new Error("Sem permissão para enviar solicitações.");

    const body = await request.json() as { fornecedorId?: unknown; solicitacaoId?: unknown };
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
    const grupos = new Map<string, {
      referencia: string;
      quantidade: number;
      divisoes: Map<string, { estampa: string; variante: string; quantidade: number }>;
    }>();

    for (const item of itensSolicitacao) {
      const associacao = associacaoPorProduto.get(item.produtoId);
      const referencia = associacao?.produtoFornecedor.referencia?.trim();
      if (!associacao || !referencia) throw new Error(`Produto ${item.sku} sem referência de produto fornecido.`);
      const consumo = Number(associacao.quantidadeUsada);
      const quantidade = item.quantidadeSolicitada * consumo;
      if (!Number.isFinite(quantidade) || quantidade <= 0) throw new Error(`Quantidade fornecida inválida para ${item.sku}.`);
      const match = item.sku.match(ESTAMPA_VARIANTE_REGEX);
      if (!match) throw new Error(`SKU ${item.sku} não contém estampa e variante no padrão EST/6835-D.`);
      const [, estampa, variante] = match;
      const grupo = grupos.get(referencia) ?? { referencia, quantidade: 0, divisoes: new Map() };
      grupo.quantidade += quantidade;
      const chave = `${estampa}\u0000${variante}`;
      const divisao = grupo.divisoes.get(chave) ?? { estampa, variante, quantidade: 0 };
      divisao.quantidade += quantidade;
      grupo.divisoes.set(chave, divisao);
      grupos.set(referencia, grupo);
    }

    const itens = [];
    const observacoes: string[] = [];
    for (const grupo of grupos.values()) {
      let produto: Record<string, unknown> | undefined;
      if (/^\d+$/.test(grupo.referencia)) {
        try {
          produto = await obterProdutoOlistApi(vendedor.aplicativoId, grupo.referencia);
        } catch {
          produto = undefined;
        }
      }
      if (!produto) {
        const resposta = await listarProdutosOlistApi(vendedor.aplicativoId, {
          codigo: grupo.referencia, situacao: "A", limit: 100, offset: 0,
        });
        produto = resposta.itens.find((item) =>
          String(item.id ?? "") === grupo.referencia || String(item.sku ?? "") === grupo.referencia,
        ) as Record<string, unknown> | undefined ?? resposta.itens[0] as Record<string, unknown> | undefined;
      }
      if (!produto?.id) throw new Error(`Produto da referência ${grupo.referencia} não encontrado na Olist.`);
      if (produto.tipo !== "F") throw new Error(`Produto da referência ${grupo.referencia} não é fabricado.`);
      const produtoId = Number(produto.id);
      if (!Number.isInteger(produtoId) || produtoId <= 0) throw new Error(`ID inválido para a referência ${grupo.referencia}.`);
      const preco = precoProduto(produto);
      if (preco === null) throw new Error(`Produto da referência ${grupo.referencia} não possui preço.`);
      const unidade = String(produto.unidade ?? "UN").trim() || "UN";
      const divisoes = Array.from(grupo.divisoes.values());
      const infoAdicional = divisoes.map((divisao) =>
        `<ESTAMPA><COD>${escaparXml(divisao.estampa)}</COD><VAR>${escaparXml(divisao.variante)}</VAR>` +
        `<QTD>${divisao.quantidade}</QTD><UN>${escaparXml(unidade)}</UN></ESTAMPA>`,
      ).join("");
      for (const divisao of divisoes) {
        observacoes.push(`${produto.descricao ?? grupo.referencia}     |     ${divisao.quantidade} ${unidade}     |     ${divisao.estampa}-${divisao.variante}`);
      }
      itens.push({
        produto: { id: produtoId, tipo: "P" },
        quantidade: grupo.quantidade,
        valorUnitario: preco,
        infoAdicional,
      });
    }

    const resultado = await criarPedidoOlistApi(vendedor.aplicativoId, {
      idContato: fornecedor.meuClienteOlistId,
      vendedor: { id: vendedor.vendedorOlistId },
      situacao: 0,
      data: new Date().toISOString().slice(0, 10),
      observacoes: observacoes.join("\n.\n"),
      itens,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao enviar pedido ao fornecedor." },
      { status: 400 },
    );
  }
}
