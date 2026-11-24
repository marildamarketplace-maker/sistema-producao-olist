import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { listarVendedoresOlistApi } from "@/lib/olist";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { prisma } from "@/lib/prisma";

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  if (valor === null || valor.trim() === "") return padrao;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  try {
    const usuario = await autorizarOlist(request, "podeVisualizarOlistVendedores");
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const resultado = await listarVendedoresOlistApi(aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      limit,
      offset,
    });
    const vendedoresIds = resultado.itens.map((vendedor) => Number(vendedor.id)).filter((id) => Number.isInteger(id) && id > 0);
    const vinculos = vendedoresIds.length ? await prisma.usuarioVendedorOlist.findMany({
      where: {
        aplicativoId: aplicativoId,
        vendedorOlistId: { in: vendedoresIds },
        usuario: { OR: [
          { aplicativoId: aplicativoId },
          { aplicativo: { filiais: { some: { id: aplicativoId } } } },
        ] },
      },
      select: { vendedorOlistId: true, usuario: { select: { id: true, nome: true, ativo: true } } },
      orderBy: [{ usuario: { nome: "asc" } }, { usuarioId: "asc" }],
      take: 1001,
    }) : [];
    const usuariosPorVendedor = new Map<number, Array<{ id: string; nome: string; ativo: boolean }>>();
    for (const vinculo of vinculos.slice(0, 1000)) {
      const usuarios = usuariosPorVendedor.get(vinculo.vendedorOlistId) ?? [];
      usuarios.push(vinculo.usuario);
      usuariosPorVendedor.set(vinculo.vendedorOlistId, usuarios);
    }
    return NextResponse.json({
      ...resultado,
      vinculosLimitados: vinculos.length > 1000,
      itens: resultado.itens.map((vendedor) => ({
        ...vendedor, usuariosVinculados: usuariosPorVendedor.get(Number(vendedor.id)) ?? [],
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: "Não foi possível consultar os vendedores na Olist." },
      { status: 500 },
    );
  }
}
