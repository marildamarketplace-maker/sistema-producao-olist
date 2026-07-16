import { NextResponse } from "next/server";
import {
  criarPedidoOlistApi,
  listarContatosOlistApi,
  listarProdutosOlistApi,
  listarVendedoresOlistApi,
} from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import {
  criarInfoAdicionalOlist,
  criarObservacoesPedidoOlist,
  extrairTamanhoSku,
  extrairTipoProdutoSku,
  type LinhaObservacaoPedidoOlist,
} from "@/lib/olist-pedido";

type DivisaoInput = { quantidade?: unknown; estampa?: unknown; variante?: unknown };
type ItemInput = { produtoId?: unknown; produtoCodigo?: unknown; produtoDescricao?: unknown; produtoUnidade?: unknown; quantidade?: unknown; valorUnitario?: unknown; divisoes?: unknown };

export async function GET(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const params = new URL(request.url).searchParams;
    const recurso = params.get("recurso") ?? "catalogo";
    const nome = params.get("nome")?.trim() || undefined;
    const codigo = params.get("codigo")?.trim() || undefined;
    const cpfCnpj = params.get("cpfCnpj")?.trim() || undefined;
    const idVendedorParam = params.get("idVendedor")?.trim();
    const idVendedor = idVendedorParam && /^\d+$/.test(idVendedorParam) ? idVendedorParam : undefined;

    if (recurso === "vendedores") {
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
        return NextResponse.json({ itens: resultados });
      }
      const resposta = await listarVendedoresOlistApi(usuario.aplicativoId, { nome, codigo, limit: 50, offset: 0 });
      return NextResponse.json({ itens: resposta.itens.filter((item) => item.situacao === "B" || item.situacao === "A") });
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
      const itens = [];
      let offset = 0;
      let total = 0;
      do {
        const resposta = await listarProdutosOlistApi(usuario.aplicativoId, { nome, codigo, limit: 100, offset });
        itens.push(...resposta.itens);
        total = resposta.paginacao.total;
        offset += 100;
      } while (!nome && !codigo && offset < total);
      return NextResponse.json({ itens: itens.filter((item) => item.tipo === "F" && item.situacao === "A") });
    }
    const [estampas, variantes] = await Promise.all([
      prisma.estampa.findMany({ orderBy: { codigo: "asc" }, select: { id: true, codigo: true, descricao: true } }),
      prisma.variante.findMany({ orderBy: { codigo: "asc" }, select: { id: true, estampaId: true, codigo: true, descricao: true } }),
    ]);
    let vendedores: Record<string, unknown>[] = [];
    try {
      let offset = 0;
      let total = 0;
      do {
        const resposta = await listarVendedoresOlistApi(usuario.aplicativoId, { limit: 100, offset });
        vendedores.push(...resposta.itens);
        total = resposta.paginacao.total;
        offset += 100;
      } while (offset < total && (!usuario.vendedorOlistId || !vendedores.some((vendedor) => Number(vendedor.id) === usuario.vendedorOlistId)));
      vendedores = vendedores.filter((vendedor) =>
        (vendedor.situacao === "B" || vendedor.situacao === "A") &&
        (!usuario.vendedorOlistId || Number(vendedor.id) === usuario.vendedorOlistId)
      );
    } catch (error) {
      console.warn("Não foi possível carregar os vendedores:", error);
    }
    return NextResponse.json({ estampas, variantes, vendedores, vendedorOlistId: usuario.vendedorOlistId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar dados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const body = await request.json() as { vendedorId?: unknown; clienteId?: unknown; itens?: unknown };
    const vendedorId = Number(body.vendedorId);
    const clienteId = Number(body.clienteId);
    if (!Number.isInteger(vendedorId) || vendedorId <= 0) throw new Error("Selecione um vendedor válido.");
    if (!Number.isInteger(clienteId) || clienteId <= 0) throw new Error("Selecione um cliente válido.");
    if (!Array.isArray(body.itens) || body.itens.length === 0) throw new Error("Adicione ao menos um produto.");

    const observacoesLinhas: LinhaObservacaoPedidoOlist[] = [];
    const produtosAdicionados = new Set<number>();
    const itens = (body.itens as ItemInput[]).map((item, indice) => {
      const produtoId = Number(item.produtoId);
      const produtoCodigo = String(item.produtoCodigo ?? produtoId).trim();
      const produtoDescricao = String(item.produtoDescricao ?? produtoCodigo).trim();
      const produtoTamanho = extrairTamanhoSku(produtoCodigo);
      const produtoTipo = extrairTipoProdutoSku(produtoCodigo);
      const produtoUnidade = String(item.produtoUnidade ?? "UN").trim() || "UN";
      const quantidade = Number(item.quantidade);
      const valorUnitario = item.valorUnitario === null || item.valorUnitario === undefined ? undefined : Number(item.valorUnitario);
      const divisoes = Array.isArray(item.divisoes) ? item.divisoes as DivisaoInput[] : [];
      if (!Number.isInteger(produtoId) || produtoId <= 0) throw new Error(`Produto ${indice + 1} inválido.`);
      if (produtosAdicionados.has(produtoId)) throw new Error(`O produto ${produtoCodigo} foi adicionado mais de uma vez.`);
      produtosAdicionados.add(produtoId);
      if (!Number.isFinite(quantidade) || quantidade < 1) throw new Error(`A quantidade mínima do produto ${indice + 1} é 1.`);
      if (valorUnitario !== undefined && (!Number.isFinite(valorUnitario) || valorUnitario < 0)) throw new Error(`Valor do produto ${indice + 1} inválido.`);
      if (divisoes.length === 0) divisoes.push({ quantidade });
      const soma = divisoes.reduce((total, divisao) => total + Number(divisao.quantidade), 0);
      if (divisoes.some((divisao) => !Number.isFinite(Number(divisao.quantidade)) || Number(divisao.quantidade) <= 0)) throw new Error(`Divisão do produto ${indice + 1} inválida.`);
      if (Math.abs(soma - quantidade) > 0.0001) throw new Error(`As divisões do produto ${indice + 1} somam ${soma}, mas a quantidade é ${quantidade}.`);
      for (const divisao of divisoes) {
        const estampa = String(divisao.estampa ?? "").trim() || "Sem estampa";
        const variante = String(divisao.variante ?? "").trim() || "Sem variante";
        observacoesLinhas.push({
          descricao: produtoDescricao,
          quantidade: Number(divisao.quantidade),
          unidade: produtoUnidade,
          estampa,
          variante,
          laser: false,
          tamanho: produtoTamanho,
          tipo: produtoTipo,
        });
      }
      return {
        produto: { id: produtoId, tipo: "P" }, quantidade,
        ...(valorUnitario !== undefined ? { valorUnitario } : {}),
        infoAdicional: criarInfoAdicionalOlist(
          divisoes.map((divisao) => ({
            ...divisao, tamanho: produtoTamanho, tipo: produtoTipo, laser: false,
          })),
          produtoUnidade,
        ),
      };
    });

    const resultado = await criarPedidoOlistApi(usuario.aplicativoId, {
      idContato: clienteId,
      vendedor: { id: vendedorId },
      situacao: 0,
      data: new Date().toISOString().slice(0, 10),
      observacoes: criarObservacoesPedidoOlist(observacoesLinhas),
      itens,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao criar pedido." }, { status: 400 });
  }
}
