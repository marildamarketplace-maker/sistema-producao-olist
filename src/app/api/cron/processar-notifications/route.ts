import { NextRequest, NextResponse } from "next/server";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { obterMensagemErro, registrarErro } from "@/lib/error-handler";
import { prisma } from "@/lib/prisma";
import { normalizarDestinatariosWhatsapp } from "@/lib/notification";
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
    const habilitados = aplicativos.filter((aplicativo) =>
      aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.NOTIFICAR),
    );
    const numerosErros = process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER?.trim();
    const destinatarios = [
      ...new Set(
        [
          ...habilitados.flatMap((aplicativo) =>
            normalizarDestinatariosWhatsapp(aplicativo.whatsapp),
          ),
          ...(numerosErros ? normalizarDestinatariosWhatsapp(numerosErros) : []),
        ],
      ),
    ];
    const resultado = await processarNotificationsPendentes({ destinatarios });
    return NextResponse.json({
      ok: resultado.erros === 0,
      aplicativosHabilitados: habilitados.length,
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
