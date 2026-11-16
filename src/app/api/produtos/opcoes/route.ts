import { carregarOpcoesProdutos, carregarOpcoesProdutosEdicao } from "@/services/opcoes-produtos";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeSolicitarProducao: true, podeVisualizarProducao: true },
    });
    if (!usuario || (!usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao)) {
      throw new Error("Sem permissão para consultar produtos.");
    }

    if (!autenticado.aplicativoId) return NextResponse.json({ error: "Aplicativo não configurado." }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const dados = params.get("perfil") === "edicao"
      ? await carregarOpcoesProdutosEdicao(autenticado.aplicativoId)
      : await carregarOpcoesProdutos(autenticado.aplicativoId, params.get("incluir_kits") === "1");
    return NextResponse.json(dados, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Erro ao carregar produtos." },
      { status: 403 },
    );
  }
}
