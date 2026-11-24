import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  const usuario = await getUsuarioAutenticado(request).catch(() => null);
  if (!usuario) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
  try {
    const empresas = await prisma.aplicativo.findMany({
      where: { OR: [{ id: usuario.aplicativoId }, { aplicativoPaiId: usuario.aplicativoId }] },
      select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }],
    });
    const filiais = empresas.filter((empresa) => empresa.id !== usuario.aplicativoId);
    const opcoes = filiais.length ? filiais : empresas;
    const aplicativoId = opcoes[0]?.id ?? usuario.aplicativoId;
    return NextResponse.json({ empresas: opcoes, aplicativoId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar as empresas." }, { status: 500 });
  }
}
