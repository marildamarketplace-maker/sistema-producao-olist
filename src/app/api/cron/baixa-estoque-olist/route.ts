import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { executarBaixaAutomaticaEstoqueOlist } from "@/lib/baixa-estoque-olist-automatica";
import { obterMensagemErro, registrarErro } from "@/lib/error-handler";
import {
  buscarPedidosParaBaixaEstoqueOlist,
  concluirBuscaBaixaEstoqueOlist,
  confirmarBaixaEstoqueOlist,
} from "@/lib/olist";
import { criarNotification } from "@/lib/notification";
import {
  criarErroNotificationBaixaEstoqueOlist,
  criarResumoNotificationBaixaEstoqueOlist,
} from "@/lib/notificacoes-baixa-estoque-olist";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function verificarAutorizacao(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();

  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

type ContextoAplicativo = {
  aplicativoId: string;
  whatsapp: string;
};

async function obterContextosAplicativos(): Promise<ContextoAplicativo[]> {
  const aplicativoIdConfigurado =
    process.env.OLIST_BAIXA_AUTOMATICA_APLICATIVO_ID?.trim();
  const integracoes = await prisma.integracaoOlistToken.findMany({
    where: {
      provider: "olist",
      status: "conectado",
      ...(aplicativoIdConfigurado
        ? { aplicativoId: aplicativoIdConfigurado }
        : {}),
    },
    select: {
      aplicativoId: true,
      aplicativo: { select: { jobs: true, whatsapp: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (integracoes.length === 0) {
    throw new Error(
      aplicativoIdConfigurado
        ? "A integração Olist configurada para a baixa automática não está conectada."
        : "Nenhuma integração Olist conectada foi encontrada.",
    );
  }

  return integracoes
    .filter((integracao) =>
      aplicativoTemJob(integracao.aplicativo.jobs, CHAVES_JOB.BAIXA_ESTOQUE),
    )
    .map((integracao) => ({
      aplicativoId: integracao.aplicativoId,
      whatsapp: integracao.aplicativo.whatsapp,
    }));
}

async function registrarNotificationSemInterromper(input: {
  to: string;
  titulo: string;
  mensagem: string;
}) {
  try {
    await criarNotification(input);
  } catch (error) {
    await registrarErro({
      contexto: "[olist-api] Falha ao registrar notification da baixa automática.",
      error,
      notificar: false,
    });
  }
}

export async function GET(request: NextRequest) {
  if (!verificarAutorizacao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const contextos = await obterContextosAplicativos();
    const resultados: Array<Record<string, unknown>> = [];
    const falhas: Array<{ aplicativoId: string; erro: string }> = [];

    for (const { aplicativoId, whatsapp } of contextos) {
      try {
        const resultado = await executarBaixaAutomaticaEstoqueOlist({
          buscarPedidos: () => buscarPedidosParaBaixaEstoqueOlist(aplicativoId),
          confirmarBaixa: confirmarBaixaEstoqueOlist,
          concluirBuscaSemBaixa: concluirBuscaBaixaEstoqueOlist,
        });

        const resumo = criarResumoNotificationBaixaEstoqueOlist(resultado);
        await registrarNotificationSemInterromper({ to: whatsapp, ...resumo });
        resultados.push({ aplicativoId, ...resultado });

        console.info("[olist-api] Baixa automática concluída para aplicativo.", {
          aplicativoId,
          pedidosEncontrados: resultado.pedidos_encontrados,
          pedidosConfirmados: resultado.pedidos_confirmados,
          pedidosPendentes: resultado.pedidos_pendentes,
          itensBaixados: resultado.itens_baixados,
          cursorAtualizado: resultado.cursor_atualizado,
        });
      } catch (error) {
        const notificationErro = criarErroNotificationBaixaEstoqueOlist({
          error,
          aplicativoId,
        });
        await registrarErro({
          contexto: "[olist-api] Falha no job de baixa automática.",
          error,
          aplicativoId,
          tituloNotification: notificationErro.titulo,
          mensagemNotification: notificationErro.mensagem,
        });
        falhas.push({ aplicativoId, erro: obterMensagemErro(error) });
      }
    }

    const data = {
      ok: falhas.length === 0,
      elegiveis: contextos.length,
      processados: resultados.length,
      resultados,
      falhas,
    };
    return NextResponse.json(data, { status: falhas.length > 0 ? 500 : 200 });
  } catch (error) {
    const aplicativoId =
      process.env.OLIST_BAIXA_AUTOMATICA_APLICATIVO_ID?.trim();
    const notificationErro = criarErroNotificationBaixaEstoqueOlist({
      error,
      aplicativoId,
    });
    const data = { error: obterMensagemErro(error) };
    const response = await registrarErro({
      contexto: "[olist-api] Falha no job de baixa automática.",
      error,
      aplicativoId,
      tituloNotification: notificationErro.titulo,
      mensagemNotification: notificationErro.mensagem,
      data,
      status: 500,
    });
    return response ?? NextResponse.json(data, { status: 500 });
  }
}
