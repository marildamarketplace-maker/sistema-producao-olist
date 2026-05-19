import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const data = await prisma.integracaoOlistToken.findUnique({
    where: { provider: "olist" },
    select: {
      status: true,
      lastLoginAt: true,
      expiresAt: true,
    },
  });

  if (!data) {
    return NextResponse.json({ status: "nao_conectado", last_login_at: null, expires_at: null });
  }

  const now = new Date();
  const expiresAt = data.expiresAt;
  const status = expiresAt && expiresAt <= now && data.status === "conectado" ? "expirado" : data.status;

  return NextResponse.json({ status, last_login_at: data.lastLoginAt, expires_at: data.expiresAt });
}
