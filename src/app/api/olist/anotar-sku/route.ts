import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buscarPedidosOlistPorDataLimite } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const SITUACOES_PERMITIDAS = new Set(["8", "0", "3", "4", "1", "7", "5", "6", "2", "9"]);

async function autenticar(request: Request) {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { podeSolicitarProducao: true, podeVisualizarProducao: true },
  });

  if (!usuario || (!usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao)) {
    throw new Error("Sem permissão para consultar os pedidos.");
  }

  return autenticado;
}

function escaparCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function agregarPorSku(itens: Array<{ sku: string; quantidade: number }>) {
  const totais = new Map<string, number>();
  for (const item of itens) totais.set(item.sku, (totais.get(item.sku) ?? 0) + item.quantidade);
  return [...totais.entries()]
    .map(([sku, quantidade]) => ({ sku, quantidade }))
    .sort((a, b) => a.sku.localeCompare(b.sku, "pt-BR", { numeric: true }));
}

export async function GET(request: NextRequest) {
  try {
    const autenticado = await autenticar(request);
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

    const skus = agregarPorSku(busca.itens);
    if (formato === "csv") {
      const csv = ["SKU,QTD", ...skus.map((item) => `${escaparCsv(item.sku)},${escaparCsv(item.quantidade)}`)].join("\r\n");
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="anotar-sku-${busca.id}.csv"`,
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

export async function POST(request: NextRequest) {
  try {
    const autenticado = await autenticar(request);
    const body = await request.json();
    const situacoes: string[] = Array.isArray(body?.situacoes)
      ? [...new Set<string>(body.situacoes.map((item: unknown) => String(item)).filter((item: string) => SITUACOES_PERMITIDAS.has(item)))]
      : [];
    if (situacoes.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos uma situação." }, { status: 400 });
    }

    const { pedidos } = await buscarPedidosOlistPorDataLimite(autenticado.aplicativoId, null, null, situacoes);
    const idsEncontrados = pedidos.map((pedido) => String(pedido.id));
    const jaSalvos = idsEncontrados.length
      ? await prisma.itemBuscaSku.findMany({
          where: { aplicativoId: autenticado.aplicativoId, pedidoOlistId: { in: idsEncontrados } },
          distinct: ["pedidoOlistId"],
          select: { pedidoOlistId: true },
        })
      : [];
    const idsJaSalvos = new Set(jaSalvos.map((item) => item.pedidoOlistId));
    const pedidosNovos = pedidos.filter((pedido) => !idsJaSalvos.has(String(pedido.id)));
    const itens: Array<{ aplicativoId: string; pedidoOlistId: string; sku: string; quantidade: number }> = [];

    for (const pedido of pedidosNovos) {
      const totaisPedido = new Map<string, number>();
      for (const item of pedido.itens ?? []) {
        const sku = String(item.produto.sku ?? "").trim();
        const quantidade = Number(item.quantidade);
        if (sku && Number.isInteger(quantidade) && quantidade > 0) {
          totaisPedido.set(sku, (totaisPedido.get(sku) ?? 0) + quantidade);
        }
      }
      for (const [sku, quantidade] of totaisPedido) {
        itens.push({ aplicativoId: autenticado.aplicativoId, pedidoOlistId: String(pedido.id), sku, quantidade });
      }
    }

    if (itens.length === 0) {
      return NextResponse.json({ busca: null, pedidosEncontrados: pedidos.length, pedidosNovos: 0 });
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

    return NextResponse.json({ busca, pedidosEncontrados: pedidos.length, pedidosNovos: pedidosNovos.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar a busca." },
      { status: 500 },
    );
  }
}
