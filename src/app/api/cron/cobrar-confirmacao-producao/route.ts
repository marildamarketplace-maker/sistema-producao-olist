import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import {
  criarAlertaConfirmacaoEntregaProducao,
  criarAlertaErroConfirmacaoEntregaProducao,
  obterLimiteConfirmacao,
  type ProducaoPendenteConfirmacao,
} from "@/lib/confirmacao-entrega-producao";
import { criarTokenPublicoConfirmacaoProducao } from "@/lib/confirmacao-entrega-producao-publica";
import { obterMensagemErro, registrarErro } from "@/lib/error-handler";
import { criarNotification } from "@/lib/notification";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verificarAutorizacao(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

function obterUrlConfirmacao(aplicativoId: string, solicitacaoId: string, agora: Date) {
  const definida = process.env.APP_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const baseUrl = definida?.replace(/\/$/, "")
    ?? (vercel ? `https://${vercel}` : null);
  if (!baseUrl) return null;
  const token = criarTokenPublicoConfirmacaoProducao({ aplicativoId, solicitacaoId, agora });
  return `${baseUrl}/confirmar-entrega-producao#token=${encodeURIComponent(token)}`;
}

async function buscarProducoesPendentes(
  aplicativoId: string,
  limiteCriacao: Date,
): Promise<ProducaoPendenteConfirmacao[]> {
  const solicitacoes = await prisma.solicitacaoProducao.findMany({
    where: {
      aplicativoId,
      status: "em_producao",
      createdAt: { lt: limiteCriacao },
    },
    select: {
      id: true,
      createdAt: true,
      dataEntrega: true,
      prioridadeProducao: true,
    },
    orderBy: [
      { prioridadeProducao: "desc" },
      { createdAt: "asc" },
    ],
  });

  if (solicitacoes.length === 0) return [];

  const itens = await prisma.itemSolicitacaoProducao.findMany({
    where: {
      aplicativoId,
      solicitacaoId: { in: solicitacoes.map((solicitacao) => solicitacao.id) },
    },
    select: { solicitacaoId: true, quantidadeSolicitada: true },
  });
  const totaisPorSolicitacao = new Map<
    string,
    { quantidadeItens: number; quantidadeUnidades: number }
  >();

  for (const item of itens) {
    const totais = totaisPorSolicitacao.get(item.solicitacaoId) ?? {
      quantidadeItens: 0,
      quantidadeUnidades: 0,
    };
    totais.quantidadeItens += 1;
    totais.quantidadeUnidades += item.quantidadeSolicitada;
    totaisPorSolicitacao.set(item.solicitacaoId, totais);
  }

  return solicitacoes.map((solicitacao) => ({
    ...solicitacao,
    ...(totaisPorSolicitacao.get(solicitacao.id) ?? {
      quantidadeItens: 0,
      quantidadeUnidades: 0,
    }),
  }));
}

export async function GET(request: NextRequest) {
  if (!verificarAutorizacao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const agora = new Date();
  try {
    const aplicativos = (await prisma.aplicativo.findMany({
      select: { id: true, jobs: true, whatsapp: true },
      orderBy: { createdAt: "asc" },
    })).filter((aplicativo) =>
      aplicativoTemJob(
        aplicativo.jobs,
        CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO,
      ),
    );
    const resultados: Array<{
      aplicativoId: string;
      pendentes: number;
      notificacoes: number;
    }> = [];
    const falhas: Array<{ aplicativoId: string; erro: string }> = [];

    for (const aplicativo of aplicativos) {
      try {
        const producoes = await buscarProducoesPendentes(
          aplicativo.id,
          obterLimiteConfirmacao(agora),
        );

        if (producoes.length === 0) {
          resultados.push({
            aplicativoId: aplicativo.id,
            pendentes: 0,
            notificacoes: 0,
          });
          continue;
        }

        for (const producao of producoes) {
          const alerta = criarAlertaConfirmacaoEntregaProducao({
            producao,
            agora,
            urlConfirmacao: obterUrlConfirmacao(aplicativo.id, producao.id, agora),
          });
          await criarNotification({ to: aplicativo.whatsapp, ...alerta });
        }
        resultados.push({
          aplicativoId: aplicativo.id,
          pendentes: producoes.length,
          notificacoes: producoes.length,
        });
      } catch (error) {
        const alertaErro = criarAlertaErroConfirmacaoEntregaProducao({
          error,
          aplicativoId: aplicativo.id,
          ocorridoEm: agora,
        });
        falhas.push({
          aplicativoId: aplicativo.id,
          erro: obterMensagemErro(error),
        });

        try {
          await criarNotification({ to: aplicativo.whatsapp, ...alertaErro });
        } catch (notificationError) {
          await registrarErro({
            contexto: `[confirmacao-entrega-producao] Falha ao notificar o erro do aplicativo ${aplicativo.id}.`,
            error: notificationError,
            aplicativoId: aplicativo.id,
            tituloNotification: alertaErro.titulo,
            mensagemNotification: alertaErro.mensagem,
          });
        }
      }
    }

    console.info("[confirmacao-entrega-producao] Job concluído.", {
      elegiveis: aplicativos.length,
      processados: resultados.length,
      notificados: resultados.reduce(
        (total, resultado) => total + resultado.notificacoes,
        0,
      ),
      falhas: falhas.length,
    });

    return NextResponse.json(
      {
        ok: falhas.length === 0,
        elegiveis: aplicativos.length,
        processados: resultados.length,
        notificados: resultados.reduce(
          (total, resultado) => total + resultado.notificacoes,
          0,
        ),
        resultados,
        falhas,
      },
      { status: falhas.length > 0 ? 500 : 200 },
    );
  } catch (error) {
    const alertaErro = criarAlertaErroConfirmacaoEntregaProducao({
      error,
      ocorridoEm: agora,
    });
    const data = { error: obterMensagemErro(error) };
    const response = await registrarErro({
      contexto: "[confirmacao-entrega-producao] Falha geral no job.",
      error,
      tituloNotification: alertaErro.titulo,
      mensagemNotification: alertaErro.mensagem,
      data,
      status: 500,
    });
    return response ?? NextResponse.json(data, { status: 500 });
  }
}
