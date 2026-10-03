import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { obterMensagemErro, registrarErro } from "@/lib/error-handler";
import { criarNotification } from "@/lib/notification";
import { gerarSolicitacaoPorPedidosOlist } from "@/lib/olist";
import { prisma } from "@/lib/prisma";
import {
  criarNotificationErroValidadorEstoque,
  criarNotificationFaltaEstoque,
  executarValidadorEstoque,
} from "@/lib/validador-estoque-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function verificarAutorizacao(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

async function obterContextosAplicativos() {
  const integracoes = await prisma.integracaoOlistToken.findMany({
    where: { provider: "olist", status: "conectado" },
    select: {
      aplicativoId: true,
      aplicativo: { select: { jobs: true, whatsapp: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return integracoes
    .filter((integracao) =>
      aplicativoTemJob(
        integracao.aplicativo.jobs,
        CHAVES_JOB.VALIDADOR_ESTOQUE,
      ),
    )
    .map((integracao) => ({
      aplicativoId: integracao.aplicativoId,
      whatsapp: integracao.aplicativo.whatsapp,
    }));
}

type ResultadoAplicativo = {
  aplicativoId: string;
  dataLimite: string;
  pedidosEncontrados: number;
  itensNovaSolicitacao: number;
  notificacaoCriada: boolean;
};

export async function GET(request: NextRequest) {
  if (!verificarAutorizacao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const contextos = await obterContextosAplicativos();
    const resultados: ResultadoAplicativo[] = [];
    const falhas: Array<{ aplicativoId: string; erro: string }> = [];

    for (const { aplicativoId, whatsapp } of contextos) {
      try {
        const execucao = await executarValidadorEstoque(
          { aplicativoId },
          gerarSolicitacaoPorPedidosOlist,
        );

        if (execucao.tipo === "SEM_ITENS_ELEGIVEIS") {
          resultados.push({
            aplicativoId,
            dataLimite: execucao.dataLimite,
            pedidosEncontrados: 0,
            itensNovaSolicitacao: 0,
            notificacaoCriada: false,
          });
          continue;
        }

        const { dataLimite, resultado } = execucao;
        const temFaltaEstoque = resultado.itens.length > 0;

        if (temFaltaEstoque) {
          await criarNotification({
            to: whatsapp,
            ...criarNotificationFaltaEstoque(resultado),
          });
        }

        resultados.push({
          aplicativoId,
          dataLimite,
          pedidosEncontrados: resultado.pedidos_encontrados,
          itensNovaSolicitacao: resultado.itens.length,
          notificacaoCriada: temFaltaEstoque,
        });
      } catch (error) {
        const notification = criarNotificationErroValidadorEstoque({
          error,
          aplicativoId,
        });
        try {
          await criarNotification({ to: whatsapp, ...notification });
        } catch (notificationError) {
          await registrarErro({
            contexto: "[olist-api] Falha ao registrar erro do VALIDADOR_ESTOQUE.",
            error: notificationError,
            aplicativoId,
          });
        }
        falhas.push({ aplicativoId, erro: obterMensagemErro(error) });
      }
    }

    console.info("[olist-api] Job VALIDADOR_ESTOQUE concluído.", {
      elegiveis: contextos.length,
      processados: resultados.length,
      notificacoesCriadas: resultados.filter(
        (resultado) => resultado.notificacaoCriada,
      ).length,
      falhas: falhas.length,
    });

    return NextResponse.json(
      {
        ok: falhas.length === 0,
        elegiveis: contextos.length,
        processados: resultados.length,
        resultados,
        falhas,
      },
      { status: falhas.length > 0 ? 500 : 200 },
    );
  } catch (error) {
    const data = { error: obterMensagemErro(error) };
    const response = await registrarErro({
      contexto: "[olist-api] Falha no job VALIDADOR_ESTOQUE.",
      error,
      tituloNotification: "Erro no validador de estoque Olist",
      data,
      status: 500,
    });
    return response ?? NextResponse.json(data, { status: 500 });
  }
}
