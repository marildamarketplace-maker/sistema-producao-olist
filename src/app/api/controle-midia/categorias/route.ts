import { NextResponse } from "next/server";
import { listarArvoreCategoriasOlist } from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  const usuario = await getUsuarioAutenticado(request);
  const categorias = await prisma.categoriaOlist.findMany({
    where: { aplicativoId: usuario.aplicativoId, ativo: true },
    orderBy: { caminho: "asc" },
  });
  return NextResponse.json({ categorias });
}

export async function POST(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const importadas = await listarArvoreCategoriasOlist(usuario.aplicativoId);
    const ids = importadas.map((item) => item.olistId);
    await prisma.$transaction([
      prisma.categoriaOlist.updateMany({
        where: { aplicativoId: usuario.aplicativoId, olistId: { notIn: ids } },
        data: { ativo: false },
      }),
      ...importadas.map((item) => prisma.categoriaOlist.upsert({
        where: { aplicativoId_olistId: { aplicativoId: usuario.aplicativoId, olistId: item.olistId } },
        create: { aplicativoId: usuario.aplicativoId, ...item },
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
