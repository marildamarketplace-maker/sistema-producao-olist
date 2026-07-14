import { NextResponse } from "next/server";
import { APLICATIVO_PADRAO_ID } from "@/lib/aplicativo";
import { listarArvoreCategoriasOlist } from "@/lib/olist";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const categorias = await prisma.categoriaOlist.findMany({
    where: { aplicativoId: APLICATIVO_PADRAO_ID, ativo: true },
    orderBy: { caminho: "asc" },
  });
  return NextResponse.json({ categorias });
}

export async function POST() {
  try {
    const importadas = await listarArvoreCategoriasOlist();
    const ids = importadas.map((item) => item.olistId);
    await prisma.$transaction([
      prisma.categoriaOlist.updateMany({
        where: { aplicativoId: APLICATIVO_PADRAO_ID, olistId: { notIn: ids } },
        data: { ativo: false },
      }),
      ...importadas.map((item) => prisma.categoriaOlist.upsert({
        where: { aplicativoId_olistId: { aplicativoId: APLICATIVO_PADRAO_ID, olistId: item.olistId } },
        create: { aplicativoId: APLICATIVO_PADRAO_ID, ...item },
        update: { nome: item.nome, caminho: item.caminho, parentOlistId: item.parentOlistId, nivel: item.nivel, ativo: true },
      })),
    ]);
    const categorias = importadas.filter((item) => item.parentOlistId === null).length;
    return NextResponse.json({
      total: importadas.length,
      categorias,
      subcategorias: importadas.length - categorias,
    });
  } catch (error) {
    console.error("Erro ao importar categorias Olist:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado" }, { status: 500 });
  }
}
