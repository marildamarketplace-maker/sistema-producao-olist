import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarFornecedores: true },
    });

    if (!solicitante?.podeVisualizarFornecedores) {
      throw new Error("Sem permissão para visualizar fornecedores.");
    }

    const usuarios = await prisma.usuario.findMany({
      where: { vendedorOlistId: { not: null } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, email: true, aplicativoId: true },
    });

    return NextResponse.json({
      usuarios: usuarios.map((usuario) => ({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        aplicativo_id: usuario.aplicativoId,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar vendedores." },
      { status: 403 },
    );
  }
}
