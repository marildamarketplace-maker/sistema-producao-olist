import type { NotificationPendente } from "@/repositories/notificationRepository";
import { enviarMensagemZApi } from "@/services/zapiService";

export async function enviarNotificationWhatsapp(
  notification: NotificationPendente,
): Promise<void> {
  await enviarMensagemZApi({
    telefone: notification.to,
    mensagem: [notification.titulo, notification.mensagem].join("\n\n"),
  });
}
