import { NextResponse } from "next/server";
import { APLICATIVO_PADRAO_ID } from "@/lib/aplicativo";
import { prisma } from "@/lib/prisma";

export async function POST() {
  await prisma.integracaoOlistToken.upsert({
    where: { provider: "olist" },
    create: {
      aplicativoId: APLICATIVO_PADRAO_ID,
      provider: "olist",
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "nao_conectado",
      updatedAt: new Date(),
    },
    update: {
      aplicativoId: APLICATIVO_PADRAO_ID,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "nao_conectado",
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ login_url: "/api/olist/login" });
}
