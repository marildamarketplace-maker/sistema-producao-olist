import { normalizarDestinatarioWhatsapp } from "@/lib/whatsapp";
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

export function normalizarDestinatariosWhatsapp(valor: string): string[] {
  const numeros = valor.split(",").map((numero) => numero.trim()).filter(Boolean);
  if (numeros.length === 0) {
    throw new Error("to deve conter um número de WhatsApp válido com DDI e DDD.");
  }
  return [...new Set(numeros.map(normalizarDestinatarioWhatsapp))];
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
    to: tipo === "WHATSAPP" ? normalizarDestinatarioWhatsapp(input.to) : input.to,
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
): Promise<Notification[]> {
  const destinatarios = (input.tipo ?? "WHATSAPP") === "WHATSAPP"
    ? normalizarDestinatariosWhatsapp(input.to)
    : [input.to];
  const dados = destinatarios.map((to) => prepararDadosNotification({ ...input, to }));
  const resultados = await Promise.allSettled(dados.map(persistir));
  const falhas = resultados.filter((resultado) => resultado.status === "rejected");
  if (falhas.length > 0) {
    throw new AggregateError(
      falhas.map((falha) => falha.reason),
      `Falha ao registrar ${falhas.length} de ${destinatarios.length} notificações.`,
    );
  }
  return resultados.flatMap((resultado) => resultado.status === "fulfilled" ? [resultado.value] : []);
}
