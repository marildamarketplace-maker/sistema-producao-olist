import { NextResponse } from "next/server";
import { criarNotification } from "@/lib/notification";

export type RegistrarErroInput = {
  contexto: string;
  error: unknown;
  aplicativoId?: string | null;
  tituloNotification?: string;
  mensagemNotification?: string;
  ocorridoEm?: Date;
  notificar?: boolean;
  data?: unknown;
  status?: number;
};

export function obterMensagemErro(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Erro inesperado ao executar a operação.";
}

export function obterWhatsappErrosConfigurado() {
  const whatsapp = process.env.WHATSAPP_ERROR_NOTIFICATION_NUMBER?.trim();
  if (!whatsapp) {
    throw new Error(
      "Variável de ambiente WHATSAPP_ERROR_NOTIFICATION_NUMBER não configurada.",
    );
  }
  return whatsapp;
}

function criarMensagemNotificationErro(input: RegistrarErroInput) {
  const ocorridoEm = input.ocorridoEm ?? new Date();
  return [
    "Um erro foi registrado pelo sistema.",
    "",
    `Data: ${ocorridoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `Contexto: ${input.contexto}`,
    `Aplicativo: ${input.aplicativoId ?? "não identificado"}`,
    `Detalhe: ${obterMensagemErro(input.error).slice(0, 1_000)}`,
  ].join("\n");
}

export async function registrarErro(
  input: RegistrarErroInput,
): Promise<NextResponse | undefined> {
  console.error(input.contexto, input.error);

  if (input.notificar !== false) {
    try {
      await criarNotification({
        to: obterWhatsappErrosConfigurado(),
        titulo: input.tituloNotification ?? "Erro no sistema",
        mensagem: input.mensagemNotification ?? criarMensagemNotificationErro(input),
        data: input.ocorridoEm,
      });
    } catch (notificationError) {
      console.error(
        `[error-handler] Falha ao registrar notification para: ${input.contexto}.`,
        notificationError,
      );
    }
  }

  if ("data" in input) {
    return NextResponse.json(input.data, { status: input.status ?? 500 });
  }
}
