import { envelopeImagemWhatsappSchema, prefixoImagemWhatsapp } from "@/lib/whatsapp-image";
import type { NotificationPendente } from "@/repositories/notificationRepository";
import { enviarMensagemZApi } from "@/services/zapiService";

export async function enviarNotificationWhatsapp(
  notification: NotificationPendente,
): Promise<void> {
  if (notification.mensagem.startsWith(prefixoImagemWhatsapp)) {
    let payload: unknown;
    try { payload = JSON.parse(notification.mensagem.slice(prefixoImagemWhatsapp.length)); }
    catch { throw new Error("Envelope de imagem inválido."); }
    const validada = envelopeImagemWhatsappSchema.safeParse(payload);
    if (!validada.success) throw new Error("Imagem WhatsApp inválida.");
    const imagem = validada.data;
    await enviarMensagemZApi({ telefone: notification.to, mensagem: imagem.caption, imagem });
    return;
  }
  await enviarMensagemZApi({
    telefone: notification.to,
    mensagem: [notification.titulo, notification.mensagem].join("\n\n"),
  });
}
