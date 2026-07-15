import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function POST(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const existente = await prisma.integracaoOlistToken.findFirst({
    where: { aplicativoId: usuario.aplicativoId, provider: "olist" }, select: { id: true },
  });
    const data = {
    aplicativoId: usuario.aplicativoId,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    status: "nao_conectado",
    updatedAt: new Date(),
  };
    if (existente) {
      await prisma.integracaoOlistToken.update({ where: { id: existente.id }, data });
    } else {
      await prisma.integracaoOlistToken.create({ data: { provider: "olist", ...data } });
    }

    const response = NextResponse.json({ login_url: "/api/olist/login" });
    response.cookies.set("olist_aplicativo_id", usuario.aplicativoId, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/olist", maxAge: 60 * 15,
    });
    return response;
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Erro ao validar usuário.";
    const status = mensagem.includes("Token") ? 401 : 500;
    return NextResponse.json({ error: mensagem }, { status });
  }
}
