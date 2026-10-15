import { createHash } from "node:crypto";
import { normalizarDestinatariosWhatsapp, prepararDadosNotification } from "@/lib/notification";

/** IDs estáveis permitem enqueue atômico e idempotente com createMany/skipDuplicates. */
export function prepararNotificationsAuditoria(input: {
  aplicativoId: string; whatsapp: string; mensagens: string[]; executadoEm: Date;
}) {
  const destinatarios = normalizarDestinatariosWhatsapp(input.whatsapp);
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(input.executadoEm);
  const assinatura = createHash("sha256").update(JSON.stringify(input.mensagens)).digest("hex");
  return destinatarios.flatMap((to) => input.mensagens.map((mensagem, indice) => {
    const hash = createHash("sha256").update(JSON.stringify(["auditoria-ref", input.aplicativoId, dia, to, assinatura, indice])).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { id, ...prepararDadosNotification({ to, titulo: "Estoque físico negativo por referência", mensagem, data: input.executadoEm }) };
  }));
}
