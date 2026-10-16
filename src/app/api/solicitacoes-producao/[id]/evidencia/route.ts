import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarDetalheProducao, respostaErroDetalheProducao } from "@/lib/producao-detalhes";
import { lerGoogleStorageImagemPrivada } from "@/services/googleStorageService";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const usuario = await autorizarDetalheProducao(request, id);
    const producao = await prisma.solicitacaoProducao.findFirst({
      where: { id, aplicativoId: usuario.aplicativoId },
      select: { evidenciaBucket: true, evidenciaStoragePath: true },
    });
    if (!producao?.evidenciaBucket || !producao.evidenciaStoragePath) {
      return NextResponse.json({ error: "Evidência não encontrada." }, { status: 404 });
    }
    const prefixo = `producao-evidencias/${usuario.aplicativoId}/${id}/`;
    if (!producao.evidenciaStoragePath.startsWith(prefixo)) {
      return NextResponse.json({ error: "Evidência indisponível." }, { status: 404 });
    }
    const imagem = await lerGoogleStorageImagemPrivada(producao.evidenciaBucket, producao.evidenciaStoragePath);
    return new Response(imagem, { headers: {
      "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="evidencia-producao.jpg"',
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) {
    const falha = respostaErroDetalheProducao(error);
    return NextResponse.json({ error: falha.mensagem }, { status: falha.status });
  }
}
