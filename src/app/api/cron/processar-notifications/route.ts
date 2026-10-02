import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { obterMensagemErro, registrarErro } from "@/lib/error-handler";
import { prisma } from "@/lib/prisma";
import { processarNotificationsPendentes } from "@/services/notificationService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const aplicativos = await prisma.aplicativo.findMany({
      select: { jobs: true, whatsapp: true },
    });
    const destinatarios = [
      ...new Set(
        aplicativos
          .filter((aplicativo) =>
            aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.NOTIFICAR),
          )
          .map((aplicativo) => aplicativo.whatsapp),
      ),
    ];
    const resultado = await processarNotificationsPendentes({ destinatarios });
    return NextResponse.json({
      ok: resultado.erros === 0,
      aplicativosHabilitados: destinatarios.length,
      ...resultado,
    });
  } catch (error) {
    const data = { error: obterMensagemErro(error) };
    const response = await registrarErro({
      contexto: "[notification] Falha no processamento da fila.",
      error,
      tituloNotification: "Erro no processamento da fila de notificações",
      data,
      status: 500,
    });
    return response ?? NextResponse.json(data, { status: 500 });
  }
}
