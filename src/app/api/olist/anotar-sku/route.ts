import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { criarExcelBuscaSku, criarPdfBuscaSku } from "@/lib/exportar-busca-sku";

import { z } from "zod";
import { autenticarSku as autenticar, erroRespostaSku, repoSku } from "@/lib/anotar-sku/api";
import { ErroAnotarSku } from "@/lib/anotar-sku/contrato";
import { dataIsoSku } from "@/lib/anotar-sku/periodo";

export const dynamic = "force-dynamic";

function escaparCsv(value: string | number) {
  const texto = String(value);
  // Aspas CSV não impedem fórmulas quando o arquivo é aberto em uma planilha.
  const seguro = typeof value === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replaceAll('"', '""')}"`;
}

function formatarDataBuscaCsv(data: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(data);
}

function agregarPorSku(itens: Array<{ sku: string; tituloProduto: string | null; quantidade: number }>) {
  const totais = new Map<string, { tituloProduto: string | null; quantidade: number }>();
  for (const item of itens) {
    const atual = totais.get(item.sku);
    totais.set(item.sku, {
      tituloProduto: atual?.tituloProduto || item.tituloProduto,
      quantidade: (atual?.quantidade ?? 0) + item.quantidade,
    });
  }
  return [...totais.entries()]
    .map(([sku, dados]) => ({ sku, ...dados }))
    .sort((a, b) => {
      const tituloA = a.tituloProduto?.trim();
      const tituloB = b.tituloProduto?.trim();
      if (tituloA && !tituloB) return -1;
      if (!tituloA && tituloB) return 1;

      const comparacaoTitulo = (tituloA ?? "").localeCompare(tituloB ?? "", "pt-BR", {
        numeric: true,
        sensitivity: "base",
      });
      return comparacaoTitulo !== 0
        ? comparacaoTitulo
        : a.sku.localeCompare(b.sku, "pt-BR", { numeric: true, sensitivity: "base" });
    });
}

async function buscarTitulosProdutosPorSku(skus: string[]) {
  const unicos = [...new Set(skus)];
  if (unicos.length === 0) return new Map<string, string>();

  const [produtosFinais, tiposProduto] = await Promise.all([
    prisma.produtoOlist.findMany({
      where: { skuFinal: { in: unicos } },
      select: { skuFinal: true, tituloFinal: true },
    }),
    prisma.tipoProduto.findMany({
      where: { sku: { in: unicos } },
      select: { sku: true, titulo: true },
    }),
  ]);

  return new Map([
    ...tiposProduto.map((produto) => [produto.sku, produto.titulo.trim()] as const),
    ...produtosFinais.map((produto) => [produto.skuFinal, produto.tituloFinal.trim()] as const),
  ].filter(([, titulo]) => Boolean(titulo)));
}

export async function GET(request: NextRequest) {
  try {
    const autenticado = await autenticar(request, "read");
    const buscaId = request.nextUrl.searchParams.get("id");
    const formato = request.nextUrl.searchParams.get("formato");
    if (buscaId && !z.uuid().safeParse(buscaId).success) throw new ErroAnotarSku("Busca inválida.", 400);

    if (!buscaId) {
      const buscas = await prisma.buscaSku.findMany({
        where: { aplicativoId: autenticado.aplicativoId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          situacoes: true,
          quantidadePedidos: true,
          quantidadeSkus: true,
          periodoInicio: true, periodoFim: true, pedidosForaPeriodo: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ buscas: buscas.map(busca => ({ ...busca, periodoInicio: dataIsoSku(busca.periodoInicio), periodoFim: dataIsoSku(busca.periodoFim) })) }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const busca = await prisma.buscaSku.findFirst({
      where: { id: buscaId, aplicativoId: autenticado.aplicativoId },
      select: {
        id: true, situacoes: true, quantidadePedidos: true, quantidadeSkus: true, createdAt: true,
        periodoInicio: true, periodoFim: true, pedidosForaPeriodo: true,
        itens: {
          orderBy: [{ pedidoOlistId: "asc" }, { sku: "asc" }],
          select: { pedidoOlistId: true, sku: true, tituloProduto: true, quantidade: true },
        },
      },
    });
    if (!busca) return NextResponse.json({ error: "Busca não encontrada." }, { status: 404 });

    const skusAgregados = agregarPorSku(busca.itens);
    const titulosPorSku = await buscarTitulosProdutosPorSku(
      skusAgregados.map((item) => item.sku),
    );
    const skus = skusAgregados.map((item) => ({
      ...item,
      tituloProduto: titulosPorSku.get(item.sku) || item.tituloProduto?.trim() || null,
    }));
    const dataBusca = formatarDataBuscaCsv(busca.createdAt);
    if (formato === "csv") {
      const csv = [
        `Data da busca,${escaparCsv(dataBusca)}`,
        "",
        "SKU,TITULO_PRODUTO,QTD",
        ...skus.map((item) =>
          `${escaparCsv(item.sku)},${escaparCsv(item.tituloProduto ?? "")},${escaparCsv(item.quantidade)}`,
        ),
      ].join("\r\n");
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="anotar-sku-${busca.id}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (formato === "xlsx") {
      return new NextResponse(Buffer.from(criarExcelBuscaSku(dataBusca, skus)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="anotar-sku-${busca.id}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (formato === "pdf") {
      return new NextResponse(Buffer.from(criarPdfBuscaSku(dataBusca, skus)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="anotar-sku-${busca.id}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      busca: {
        id: busca.id,
        situacoes: busca.situacoes,
        quantidadePedidos: busca.quantidadePedidos,
        quantidadeSkus: busca.quantidadeSkus,
        periodoInicio: dataIsoSku(busca.periodoInicio), periodoFim: dataIsoSku(busca.periodoFim), pedidosForaPeriodo: busca.pedidosForaPeriodo,
        createdAt: busca.createdAt,
        pedidos: [...new Set(busca.itens.map((item) => item.pedidoOlistId))],
        skus,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return erroRespostaSku(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const autenticado = await autenticar(request, "write");
    const buscaId = request.nextUrl.searchParams.get("id");
    if (!buscaId) {
      return NextResponse.json({ error: "Informe a busca que será excluída." }, { status: 400 });
    }

    if (!z.uuid().safeParse(buscaId).success) throw new ErroAnotarSku("Busca inválida.", 400);
    await repoSku.excluir(autenticado, buscaId);

    return NextResponse.json({ excluida: true });
  } catch (error) { return erroRespostaSku(error); }
}

// Abas antigas precisam atualizar o contrato; nunca interpretar 202 como resultado vazio.
export async function POST(request: NextRequest) {
  try {
    await autenticar(request, "write");
    return NextResponse.json({ error: "A busca agora funciona em segundo plano. Atualize a página para continuar." }, { status: 409 });
  } catch (error) { return erroRespostaSku(error); }
}
