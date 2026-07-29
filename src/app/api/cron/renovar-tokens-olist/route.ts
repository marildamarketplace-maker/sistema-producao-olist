import { NextRequest, NextResponse } from "next/server";
import { getValidOlistAccessToken } from "@/lib/olist";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JANELA_RENOVACAO_MS = 70 * 60 * 1000;
const CONCORRENCIA_MAXIMA = 3;

function verificarAutorizacao(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(
    secret &&
    request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function GET(request: NextRequest) {
  if (!verificarAutorizacao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const limiteExpiracao = new Date(Date.now() + JANELA_RENOVACAO_MS);
    const integracoes = await prisma.integracaoOlistToken.findMany({
      where: {
        provider: "olist",
        status: "conectado",
        refreshToken: { not: null },
        OR: [
          { expiresAt: null },
          { expiresAt: { lte: limiteExpiracao } },
        ],
      },
      select: {
        aplicativoId: true,
      },
      orderBy: {
        expiresAt: "asc",
      },
    });

    let proximoIndice = 0;
    const renovados: string[] = [];
    const erros: Array<{ aplicativoId: string; erro: string }> = [];

    async function processarProximaIntegracao() {
      while (proximoIndice < integracoes.length) {
        const indice = proximoIndice;
        proximoIndice += 1;
        const integracao = integracoes[indice];

        try {
          await getValidOlistAccessToken(integracao.aplicativoId, {
            validadeMinimaMs: JANELA_RENOVACAO_MS,
          });
          renovados.push(integracao.aplicativoId);
        } catch (error) {
          erros.push({
            aplicativoId: integracao.aplicativoId,
            erro:
              error instanceof Error
                ? error.message
                : "Erro desconhecido ao renovar token.",
          });
        }
      }
    }

    const quantidadeWorkers = Math.min(
      CONCORRENCIA_MAXIMA,
      integracoes.length,
    );
    await Promise.all(
      Array.from(
        { length: quantidadeWorkers },
        () => processarProximaIntegracao(),
      ),
    );

    console.info("[olist-api] Job de renovação de tokens concluído.", {
      elegiveis: integracoes.length,
      renovados: renovados.length,
      erros: erros.length,
    });

    return NextResponse.json({
      ok: erros.length === 0,
      elegiveis: integracoes.length,
      renovados: renovados.length,
      erros: erros.length,
      falhas: erros,
    });
  } catch (error) {
    console.error("[olist-api] Falha no job de renovação de tokens.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao executar o job.",
      },
      { status: 500 },
    );
  }
}
