import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request).catch(() => null);
    if (!autenticado) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const solicitante = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarFornecedores: true },
    });
    if (!solicitante?.podeVisualizarFornecedores) {
      return NextResponse.json({ error: "Sem permissão para visualizar fornecedores." }, { status: 403 });
    }
    const aplicativosPai = await prisma.aplicativo.findMany({
      where: { aplicativoPaiId: null },
      select: { id: true, nome: true },
      orderBy: [{ nome: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ aplicativosPai }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível listar os aplicativos pai." }, { status: 500 });
  }
}
