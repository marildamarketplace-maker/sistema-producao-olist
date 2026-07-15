import { NextResponse } from "next/server";
import { listarVendedoresOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { prisma } from "@/lib/prisma";

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  try {
    const usuario = await getUsuarioAutenticado(request);
    const resultado = await listarVendedoresOlistApi(usuario.aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      limit,
      offset,
    });
    const vendedoresIds = resultado.itens.map((vendedor) => Number(vendedor.id)).filter((id) => Number.isInteger(id) && id > 0);
    const usuarios = await prisma.usuario.findMany({
      where: { aplicativoId: usuario.aplicativoId, vendedorOlistId: { in: vendedoresIds } },
      select: { id: true, nome: true, email: true, ativo: true, vendedorOlistId: true },
    });
    const usuarioPorVendedor = new Map(usuarios.map((item) => [item.vendedorOlistId, item]));
    return NextResponse.json({
      ...resultado,
      itens: resultado.itens.map((vendedor) => ({ ...vendedor, usuarioVinculado: usuarioPorVendedor.get(Number(vendedor.id)) ?? null })),
    });
  } catch (error) {
    console.error("Erro ao listar vendedores Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
