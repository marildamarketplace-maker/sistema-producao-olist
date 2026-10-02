import type {
  Notification,
  NotificationStatus,
  NotificationType,
  Prisma,
} from "@prisma/client";

export type CriarNotificationInput = {
  tipo?: NotificationType;
  to: string;
  titulo: string;
  mensagem: string;
  data?: Date;
};

type PersistirNotification = (
  dados: Prisma.NotificationCreateInput,
) => Promise<Notification>;

function validarTexto(valor: string, campo: "titulo" | "mensagem") {
  if (!valor.trim()) throw new Error(`${campo} é obrigatório.`);
  return valor;
}

function normalizarNumeroWhatsapp(to: string) {
  const numero = to.replace(/\D/g, "");
  if (numero.length < 10 || numero.length > 15) {
    throw new Error("to deve conter um número de WhatsApp válido com DDI e DDD.");
  }
  return numero;
}

export function prepararDadosNotification(
  input: CriarNotificationInput,
): Prisma.NotificationCreateInput {
  const tipo: NotificationType = input.tipo ?? "WHATSAPP";
  const data = input.data ?? new Date();
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
    throw new Error("data deve ser uma data válida.");
  }

  return {
    tipo,
    to: tipo === "WHATSAPP" ? normalizarNumeroWhatsapp(input.to) : input.to,
    titulo: validarTexto(input.titulo, "titulo"),
    mensagem: validarTexto(input.mensagem, "mensagem"),
    data,
    status: "PENDENTE" satisfies NotificationStatus,
  };
}

async function persistirNotification(
  dados: Prisma.NotificationCreateInput,
): Promise<Notification> {
  const { prisma } = await import("@/lib/prisma");
  return prisma.notification.create({ data: dados });
}

export async function criarNotification(
  input: CriarNotificationInput,
  persistir: PersistirNotification = persistirNotification,
): Promise<Notification> {
  return persistir(prepararDadosNotification(input));
}
