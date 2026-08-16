import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buscarPedidosOlistPorDataLimite } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { criarExcelBuscaSku, criarPdfBuscaSku } from "@/lib/exportar-busca-sku";

const SITUACOES_PERMITIDAS = new Set(["8", "0", "3", "4", "1", "7", "5", "6", "2", "9"]);

export const maxDuration = 300;

async function autenticar(request: Request, permissao: "read" | "write") {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { podeEscreverAnotarSku: true, podeVisualizarAnotarSku: true },
  });

  const permitido = permissao === "write"
    ? usuario?.podeEscreverAnotarSku
    : usuario?.podeVisualizarAnotarSku;
  if (!permitido) {
    throw new Error(permissao === "write" ? "Sem permissão para buscar pedidos." : "Sem permissão para visualizar o histórico.");
  }

  return autenticado;
}

function escaparCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
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
    ...tiposProduto.map((produto) => [produto.sku, produto.titulo] as const),
    ...produtosFinais.map((produto) => [produto.skuFinal, produto.tituloFinal] as const),
  ]);
}

export async function GET(request: NextRequest) {
  try {
    const autenticado = await autenticar(request, "read");
    const buscaId = request.nextUrl.searchParams.get("id");
    const formato = request.nextUrl.searchParams.get("formato");

    if (!buscaId) {
      const buscas = await prisma.buscaSku.findMany({
        where: { aplicativoId: autenticado.aplicativoId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          situacoes: true,
          quantidadePedidos: true,
          quantidadeSkus: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ buscas });
    }

    const busca = await prisma.buscaSku.findFirst({
      where: { id: buscaId, aplicativoId: autenticado.aplicativoId },
      include: { itens: { orderBy: [{ pedidoOlistId: "asc" }, { sku: "asc" }] } },
    });
    if (!busca) return NextResponse.json({ error: "Busca não encontrada." }, { status: 404 });

    const skusAgregados = agregarPorSku(busca.itens);
    const titulosPorSku = await buscarTitulosProdutosPorSku(
      skusAgregados.map((item) => item.sku),
    );
    const skus = skusAgregados.map((item) => ({
      ...item,
      tituloProduto: titulosPorSku.get(item.sku) ?? null,
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
        createdAt: busca.createdAt,
        pedidos: [...new Set(busca.itens.map((item) => item.pedidoOlistId))],
        skus,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar as buscas." },
      { status: 403 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const autenticado = await autenticar(request, "write");
    const buscaId = request.nextUrl.searchParams.get("id");
    if (!buscaId) {
      return NextResponse.json({ error: "Informe a busca que será excluída." }, { status: 400 });
    }

    const resultado = await prisma.buscaSku.deleteMany({
      where: { id: buscaId, aplicativoId: autenticado.aplicativoId },
    });
    if (resultado.count === 0) {
      return NextResponse.json({ error: "Busca não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ excluida: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao excluir a busca." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const autenticado = await autenticar(request, "write");
    const body = await request.json();
    const situacoes: string[] = Array.isArray(body?.situacoes)
      ? [...new Set<string>(body.situacoes.map((item: unknown) => String(item)).filter((item: string) => SITUACOES_PERMITIDAS.has(item)))]
      : [];
    if (situacoes.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos uma situação." }, { status: 400 });
    }

    const jaSalvos = await prisma.itemBuscaSku.findMany({
      where: { aplicativoId: autenticado.aplicativoId },
      distinct: ["pedidoOlistId"],
      select: { pedidoOlistId: true },
    });
    const idsJaSalvos = new Set(jaSalvos.map((item) => item.pedidoOlistId));
    const { pedidos: pedidosNovos, pedidosEncontrados } = await buscarPedidosOlistPorDataLimite(
      autenticado.aplicativoId,
      null,
      null,
      situacoes,
      idsJaSalvos,
    );
    const itens: Array<{ aplicativoId: string; pedidoOlistId: string; sku: string; tituloProduto: string | null; quantidade: number }> = [];

    for (const pedido of pedidosNovos) {
      const totaisPedido = new Map<string, { tituloProduto: string | null; quantidade: number }>();
      for (const item of pedido.itens ?? []) {
        const sku = String(item.produto.sku ?? "").trim();
        const quantidade = Number(item.quantidade);
        if (sku && Number.isInteger(quantidade) && quantidade > 0) {
          const atual = totaisPedido.get(sku);
          totaisPedido.set(sku, {
            tituloProduto: atual?.tituloProduto ?? null,
            quantidade: (atual?.quantidade ?? 0) + quantidade,
          });
        }
      }
      for (const [sku, dados] of totaisPedido) {
        itens.push({
          aplicativoId: autenticado.aplicativoId,
          pedidoOlistId: String(pedido.id),
          sku,
          tituloProduto: dados.tituloProduto,
          quantidade: dados.quantidade,
        });
      }
    }

    if (itens.length === 0) {
      return NextResponse.json({ busca: null, pedidosEncontrados, pedidosNovos: 0 });
    }

    const titulosPorSku = await buscarTitulosProdutosPorSku(
      itens.map((item) => item.sku),
    );
    for (const item of itens) {
      item.tituloProduto = titulosPorSku.get(item.sku) ?? null;
    }

    const quantidadeSkus = new Set(itens.map((item) => item.sku)).size;
    const busca = await prisma.$transaction(async (tx) => {
      const criada = await tx.buscaSku.create({
        data: {
          aplicativoId: autenticado.aplicativoId,
          situacoes,
          quantidadePedidos: pedidosNovos.length,
          quantidadeSkus,
        },
      });
      await tx.itemBuscaSku.createMany({ data: itens.map((item) => ({ ...item, buscaId: criada.id })) });
      return criada;
    });

    return NextResponse.json({ busca, pedidosEncontrados, pedidosNovos: pedidosNovos.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar a busca." },
      { status: 500 },
    );
  }
}
