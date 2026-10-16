import { lerFormularioConfirmacao } from "@/lib/confirmacao-producao-form";
import { confirmarProducaoComEvidencia } from "@/lib/producao-evidencia";
import { EvidenciaProducaoError } from "@/lib/producao-evidencia-contrato";
import { NextResponse } from "next/server";
import {
  normalizarItensConfirmacaoProducao,
} from "@/lib/confirmar-producao";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { senhaPublicaConfirmacaoValida } from "@/lib/confirmacao-entrega-producao-publica";
import { estaBloqueado, registrarSenhaInvalida, limparTentativasSenha } from "@/lib/confirmacao-producao-tentativas";

export async function POST(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeConfirmarProducao: true },
    });
    if (!usuario?.podeConfirmarProducao) {
      return NextResponse.json(
        { error: "Sem permissão para confirmar produção." },
        { status: 403 },
      );
    }

    const chaveTentativas = `interno:${autenticado.aplicativoId}:${autenticado.id}`;
    if (estaBloqueado(chaveTentativas)) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, { status: 429 });
    }

    const body = await lerFormularioConfirmacao(request);
    if (!senhaPublicaConfirmacaoValida(body.senha)) {
      registrarSenhaInvalida(chaveTentativas);
      return NextResponse.json({ error: "Senha inválida." }, { status: 401 });
    }
    limparTentativasSenha(chaveTentativas);
    const solicitacaoId = typeof body.solicitacaoId === "string"
      ? body.solicitacaoId.trim()
      : "";
    if (!solicitacaoId) {
      return NextResponse.json(
        { error: "Informe a solicitação." },
        { status: 400 },
      );
    }

    const itens = normalizarItensConfirmacaoProducao(body.itens);
    await confirmarProducaoComEvidencia({
      aplicativoId: autenticado.aplicativoId,
      solicitacaoId,
      itens,
      foto: body.foto,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EvidenciaProducaoError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Erro ao confirmar produção.");
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Erro inesperado ao confirmar produção.",
      },
      { status: 400 },
    );
  }
}
