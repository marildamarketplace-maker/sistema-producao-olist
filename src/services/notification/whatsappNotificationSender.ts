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
    await enviarMensagemZApi({ telefone: notification.to, mensagem: legendaComTituloUnico(notification.titulo, imagem.caption), imagem });
    return;
  }
  await enviarMensagemZApi({
    telefone: notification.to,
    mensagem: [notification.titulo, notification.mensagem].join("\n\n"),
  });
}

// Aceita envelopes antigos que já traziam o título na legenda.
export function legendaComTituloUnico(titulo: string, legenda: string): string {
  const linhas = legenda.replace(/\r\n?/g, "\n").trim().split("\n");
  while (linhas[0]?.trim() === titulo.trim()) {
    linhas.shift();
    while (linhas[0]?.trim() === "") linhas.shift();
  }
  return [titulo.trim(), linhas.join("\n").trim()].filter(Boolean).join("\n\n");
}
