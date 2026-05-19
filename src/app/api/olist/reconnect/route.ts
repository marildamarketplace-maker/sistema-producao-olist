import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  await prisma.integracaoOlistToken.upsert({
    where: { provider: "olist" },
    create: {
      provider: "olist",
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "nao_conectado",
      updatedAt: new Date(),
    },
    update: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "nao_conectado",
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ login_url: "/api/olist/login" });
}
