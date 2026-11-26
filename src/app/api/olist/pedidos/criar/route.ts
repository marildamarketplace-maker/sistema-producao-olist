import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  criarPedidoOlistApi,
  listarFormasRecebimentoOlistApi,
  listarContatosOlistApi,
  listarProdutosOlistApi,
  listarVendedoresOlistApi,
} from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import { obterVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import {
  criarInfoAdicionalOlist,
  criarObservacoesPedidoOlist,
  extrairTamanhoSku,
  extrairTipoProdutoSku,
  type LinhaObservacaoPedidoOlist,
} from "@/lib/olist-pedido";

type DivisaoInput = { quantidade?: unknown; estampa?: unknown; variante?: unknown; tipo?: unknown; tamanho?: unknown; laser?: unknown };
type ItemInput = { produtoId?: unknown; produtoCodigo?: unknown; produtoDescricao?: unknown; produtoUnidade?: unknown; quantidade?: unknown; valorUnitario?: unknown; tipo?: unknown; tamanho?: unknown; laser?: unknown; divisoes?: unknown };

class ErroEntradaPedidoOlist extends Error {}

function lerIdOlist(valor: unknown, nome: string) {
  if ((typeof valor !== "number" && typeof valor !== "string") ||
      (typeof valor === "string" && !/^[1-9]\d*$/.test(valor))) {
    throw new ErroEntradaPedidoOlist(`Selecione um ${nome} válido.`);
  }
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroEntradaPedidoOlist(`Selecione um ${nome} válido.`);
  return id;
}

function criarPagamentoPedido(formaRecebimentoId: number, nomePlano: string, valorTotal: number) {
  const dias = nomePlano.toLocaleLowerCase("pt-BR") === "a vista"
    ? [0]
    : nomePlano.split("/").map(Number);
  if (dias.some((dia) => !Number.isInteger(dia) || dia < 0)) {
    throw new ErroEntradaPedidoOlist("O plano de recebimento possui parcelas inválidas.");
  }

  const totalCentavos = Math.round(valorTotal * 100);
  const baseCentavos = Math.floor(totalCentavos / dias.length);
  const resto = totalCentavos - baseCentavos * dias.length;
  return {
    formaRecebimento: { id: formaRecebimentoId },
    parcelas: dias.map((dia, indice) => ({
      dias: dia,
      valor: (baseCentavos + (indice < resto ? 1 : 0)) / 100,
      formaRecebimento: { id: formaRecebimentoId },
    })),
  };
}

const listarProdutosCriacaoComCache = unstable_cache(
  async (aplicativoId: string, nome: string, codigo: string) => {
    const itens = [];
    let offset = 0;
    let total = 0;
    do {
      const resposta = await listarProdutosOlistApi(aplicativoId, {
        nome: nome || undefined,
        codigo: codigo || undefined,
        limit: 100,
        offset,
      });
      itens.push(...resposta.itens);
      total = resposta.paginacao.total;
      offset += 100;
    } while (!nome && !codigo && offset < total);

    return itens.filter((item) => item.tipo === "F" && item.situacao === "A");
  },
  ["olist-pedidos-criar-produtos"],
  { revalidate: 60 * 60 },
);

export async function GET(request: Request) {
  try {
    const usuario = await autorizarOlist(request, "podeCriarOlistPedido");
    const params = new URL(request.url).searchParams;
    const recurso = params.get("recurso") ?? "catalogo";
    const nome = params.get("nome")?.trim() || undefined;
    const codigo = params.get("codigo")?.trim() || undefined;
    const cpfCnpj = params.get("cpfCnpj")?.trim() || undefined;
    const idVendedorParam = params.get("idVendedor")?.trim();
    const idVendedor = idVendedorParam && /^\d+$/.test(idVendedorParam) ? idVendedorParam : undefined;

    if (recurso === "vendedores") {
      const offset = Number(params.get("offset") ?? "0");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
        return NextResponse.json({ error: "Página de vendedores inválida." }, { status: 400 });
      }
      if (cpfCnpj) {
        const contatos = await listarContatosOlistApi(usuario.aplicativoId, { cpfCnpj, limit: 10, offset: 0 });
        const codigos = contatos.itens
          .filter((item) => item.situacao === "B" || item.situacao === "A")
          .map((item) => String(item.codigo ?? "").trim())
          .filter(Boolean);
        const resultados = [];
        for (const codigoContato of codigos) {
          const resposta = await listarVendedoresOlistApi(usuario.aplicativoId, { codigo: codigoContato, limit: 10, offset: 0 });
          resultados.push(...resposta.itens.filter((item) => item.situacao === "B" || item.situacao === "A"));
        }
        return NextResponse.json({ itens: resultados, paginacao: { total: resultados.length, limit: 100, offset: 0 } });
      }
      const resposta = await listarVendedoresOlistApi(usuario.aplicativoId, { nome, codigo, limit: 100, offset });
      return NextResponse.json({ itens: resposta.itens.filter((item) => item.situacao === "B" || item.situacao === "A"), paginacao: resposta.paginacao });
    }
    if (recurso === "clientes") {
      const itens = [];
      let offset = 0;
      let total = 0;
      do {
        const resposta = await listarContatosOlistApi(usuario.aplicativoId, { nome, codigo, cpfCnpj, idVendedor, limit: 100, offset });
        itens.push(...resposta.itens);
        total = resposta.paginacao.total;
        offset += 100;
      } while (!nome && !codigo && !cpfCnpj && offset < total);
      return NextResponse.json({ itens: itens.filter((item) =>
        (item.situacao === "B" || item.situacao === "A") && item.statusCrm === "C"
      ) });
    }
    if (recurso === "produtos") {
      const itens = await listarProdutosCriacaoComCache(
        usuario.aplicativoId,
        nome ?? "",
        codigo ?? "",
      );
      return NextResponse.json(
        { itens },
        { headers: { "Cache-Control": "private, max-age=0" } },
      );
    }
    if (recurso === "formas-pagamento") return NextResponse.json({ error: "Utilize formas-recebimento e selecione um novo plano." }, { status: 410 });
    if (recurso === "formas-recebimento") {
      const offset = Number(params.get("offset") ?? "0");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ErroEntradaPedidoOlist("Página de recebimentos inválida.");
      const resposta = await listarFormasRecebimentoOlistApi(usuario.aplicativoId, { nome, situacao: 1, limit: 50, offset });
      const formas = resposta.itens;
      const associacoes = await prisma.formaRecebimentoOlistPlano.findMany({
        where: { aplicativoId: usuario.aplicativoId, formaOlistId: { in: formas.map(f => String(f.id)) }, planoPagamento: { ativo: true } },
        take: 5001,
        select: {
          formaOlistId: true,
          planoPagamento: { select: { id: true, nome: true, ativo: true } },
        },
      });
      if (associacoes.length > 5000) throw new ErroEntradaPedidoOlist("Revise a quantidade de planos associados.");
      const planosPorForma = new Map<string, Array<{ id: string; nome: string }>>();
      for (const associacao of associacoes) {
        if (!associacao.planoPagamento.ativo) continue;
        const planos = planosPorForma.get(associacao.formaOlistId) ?? [];
        planos.push({ id: associacao.planoPagamento.id, nome: associacao.planoPagamento.nome });
        planosPorForma.set(associacao.formaOlistId, planos);
      }

      return NextResponse.json({
        paginacao: resposta.paginacao,
        itens: formas.map((forma) => ({
          ...forma,
          planos: planosPorForma.get(String(forma.id)) ?? [],
        })),
      });
    }
    const [estampas, variantes, tiposProduto, tamanhos] = await Promise.all([
      prisma.estampa.findMany({ orderBy: { codigo: "asc" }, select: { id: true, codigo: true, descricao: true } }),
      prisma.variante.findMany({ orderBy: { codigo: "asc" }, select: { id: true, estampaId: true, codigo: true, descricao: true } }),
      prisma.tipoProduto.findMany({ orderBy: { titulo: "asc" }, select: { id: true, sku: true, titulo: true } }),
      prisma.tamanho.findMany({ orderBy: { titulo: "asc" }, select: { id: true, sku: true, titulo: true } }),
    ]);
    const vendedorOlistId = await obterVendedorDoUsuario(usuario.id, usuario.aplicativoId);
    // A lista inicial é limitada. A etapa de seleção pesquisa/pagina sob demanda.
    const respostaVendedores = await listarVendedoresOlistApi(usuario.aplicativoId, { limit: 100, offset: 0 });
    const vendedores = respostaVendedores.itens.filter((vendedor) => vendedor.situacao === "B" || vendedor.situacao === "A");
    return NextResponse.json({
      estampas,
      variantes,
      tiposProduto: tiposProduto.map((tipo) => ({ id: tipo.id, codigo: tipo.sku, nome: tipo.titulo })),
      tamanhos: tamanhos.map((tamanho) => ({ id: tamanho.id, codigo: tamanho.sku, descricao: tamanho.titulo })),
      vendedores,
      vendedoresPaginacao: respostaVendedores.paginacao,
      vendedorOlistId,
    });
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível carregar os dados da conta Olist." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const usuario = await autorizarOlist(request, "podeCriarOlistPedido");
    const bodyJson: unknown = await request.json().catch(() => { throw new ErroEntradaPedidoOlist("Informe um pedido válido."); });
    if (!bodyJson || typeof bodyJson !== "object" || Array.isArray(bodyJson)) throw new ErroEntradaPedidoOlist("Informe um pedido válido.");
    const body = bodyJson as {
      vendedorId?: unknown;
      clienteId?: unknown;
      formaRecebimentoId?: unknown;
      planoPagamentoId?: unknown;
      tipoVenda?: unknown;
      observacaoPedido?: unknown;
      observacaoEntrega?: unknown;
      itens?: unknown;
      acao?: unknown;
    };
    const vendedorId = lerIdOlist(body.vendedorId, "vendedor");
    const clienteId = lerIdOlist(body.clienteId, "cliente");
    const formaRecebimentoId = String(body.formaRecebimentoId ?? "").trim();
    const planoPagamentoId = String(body.planoPagamentoId ?? "").trim();
    const tipoVenda = String(body.tipoVenda ?? "").trim().toLowerCase();
    const observacaoPedido = String(body.observacaoPedido ?? "").trim();
    const observacaoEntrega = String(body.observacaoEntrega ?? "").trim();
    if (!/^\d+$/.test(formaRecebimentoId)) throw new ErroEntradaPedidoOlist("Selecione uma forma de recebimento válida.");
    if (!planoPagamentoId) throw new ErroEntradaPedidoOlist("Selecione um plano de recebimento.");
    if (!["venda", "venda g", "venda pc"].includes(tipoVenda)) throw new ErroEntradaPedidoOlist("Selecione um tipo de venda válido.");
    if (!Array.isArray(body.itens) || body.itens.length === 0) throw new ErroEntradaPedidoOlist("Adicione ao menos um produto.");

    const associacaoPlano = await prisma.formaRecebimentoOlistPlano.findUnique({
      where: {
        aplicativoId_formaOlistId_planoPagamentoId: {
          aplicativoId: usuario.aplicativoId,
          formaOlistId: formaRecebimentoId,
          planoPagamentoId,
        },
      },
      select: { planoPagamento: { select: { nome: true, ativo: true } } },
    });
    if (!associacaoPlano?.planoPagamento.ativo) {
      throw new ErroEntradaPedidoOlist("O plano selecionado não está associado à forma de recebimento.");
    }

    const observacoesLinhas: LinhaObservacaoPedidoOlist[] = [];
    const produtosAdicionados = new Set<number>();
    const itens = (body.itens as ItemInput[]).map((item, indice) => {
      const produtoId = Number(item.produtoId);
      const produtoCodigo = String(item.produtoCodigo ?? produtoId).trim();
      const produtoDescricao = String(item.produtoDescricao ?? produtoCodigo).trim();
      const produtoTamanho = String(item.tamanho ?? extrairTamanhoSku(produtoCodigo)).trim();
      const produtoTipo = String(item.tipo ?? extrairTipoProdutoSku(produtoCodigo)).trim();
      const produtoLaser = item.laser === true || String(item.laser ?? "").trim().toLowerCase() === "true";
      const produtoUnidade = String(item.produtoUnidade ?? "UN").trim() || "UN";
      const quantidade = Number(item.quantidade);
      const valorUnitario = item.valorUnitario === null || item.valorUnitario === undefined ? undefined : Number(item.valorUnitario);
      const divisoes = Array.isArray(item.divisoes) ? item.divisoes as DivisaoInput[] : [];
      if (!Number.isInteger(produtoId) || produtoId <= 0) throw new ErroEntradaPedidoOlist(`Produto ${indice + 1} inválido.`);
      if (produtosAdicionados.has(produtoId)) throw new ErroEntradaPedidoOlist(`O produto ${produtoCodigo} foi adicionado mais de uma vez.`);
      produtosAdicionados.add(produtoId);
      if (!Number.isFinite(quantidade) || quantidade < 1) throw new ErroEntradaPedidoOlist(`A quantidade mínima do produto ${indice + 1} é 1.`);
      if (valorUnitario !== undefined && (!Number.isFinite(valorUnitario) || valorUnitario < 0)) throw new ErroEntradaPedidoOlist(`Valor do produto ${indice + 1} inválido.`);
      if (divisoes.length === 0) divisoes.push({ quantidade });
      const soma = divisoes.reduce((total, divisao) => total + Number(divisao.quantidade), 0);
      if (divisoes.some((divisao) => !Number.isFinite(Number(divisao.quantidade)) || Number(divisao.quantidade) <= 0)) throw new ErroEntradaPedidoOlist(`Divisão do produto ${indice + 1} inválida.`);
      if (Math.abs(soma - quantidade) > 0.0001) throw new ErroEntradaPedidoOlist(`As divisões do produto ${indice + 1} somam ${soma}, mas a quantidade é ${quantidade}.`);
      for (const divisao of divisoes) {
        const estampa = String(divisao.estampa ?? "").trim();
        const variante = String(divisao.variante ?? "").trim();
        const tipoDivisao = String(divisao.tipo ?? produtoTipo).trim();
        const tamanhoDivisao = String(divisao.tamanho ?? produtoTamanho).trim();
        const laserDivisao = divisao.laser === undefined
          ? produtoLaser
          : divisao.laser === true || String(divisao.laser).trim().toLowerCase() === "true";
        const unidadeDivisao = laserDivisao ? "UN" : "MT";
        observacoesLinhas.push({
          descricao: produtoDescricao,
          quantidade: Number(divisao.quantidade),
          unidade: unidadeDivisao,
          estampa,
          variante,
          laser: laserDivisao,
          tamanho: tamanhoDivisao,
          tipo: tipoDivisao,
        });
      }
      return {
        produto: { id: produtoId, tipo: "P" }, quantidade,
        ...(valorUnitario !== undefined ? { valorUnitario } : {}),
        infoAdicional: criarInfoAdicionalOlist(
          divisoes.map((divisao) => ({
            ...divisao,
            tamanho: String(divisao.tamanho ?? produtoTamanho).trim(),
            tipo: String(divisao.tipo ?? produtoTipo).trim(),
            laser: divisao.laser === undefined
              ? produtoLaser
              : divisao.laser === true || String(divisao.laser).trim().toLowerCase() === "true",
            unidade: (divisao.laser === undefined
              ? produtoLaser
              : divisao.laser === true || String(divisao.laser).trim().toLowerCase() === "true") ? "UN" : "MT",
          })),
          produtoUnidade,
        ),
      };
    });

    const observacoesProdutos = criarObservacoesPedidoOlist(observacoesLinhas);
    const identificacaoTipoVenda = `Tipo de venda: ${tipoVenda}`;
    const observacoes = [
      identificacaoTipoVenda,
      observacaoPedido ? `Observação do pedido: ${observacaoPedido}` : "",
      observacaoEntrega ? `Observação de entrega: ${observacaoEntrega}` : "",
    ].filter(Boolean).join("\n\n");
    const observacoesInternas = observacoesProdutos;

    const pedido = {
      idContato: clienteId,
      vendedor: { id: vendedorId },
      situacao: 0,
      data: new Date().toISOString().slice(0, 10),
      observacoes,
      observacoesInternas,
      pagamento: criarPagamentoPedido(
        Number(formaRecebimentoId),
        associacaoPlano.planoPagamento.nome,
        itens.reduce((total, item) => total + item.quantidade * (item.valorUnitario ?? 0), 0),
      ),
      itens,
    };

    if (body.acao === "preview") {
      return NextResponse.json({ pedido });
    }

    const resultado = await criarPedidoOlistApi(usuario.aplicativoId, pedido);
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ErroEntradaPedidoOlist) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível criar o pedido. Confira os dados e a integração Olist." }, { status: 502 });
  }
}
