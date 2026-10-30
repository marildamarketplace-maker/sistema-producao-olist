/** Normaliza telefones e preserva IDs de grupo no formato usado pela Z-API. */
export function normalizarDestinatarioWhatsapp(valor: string): string {
  const destinatario = valor.trim();
  if (/^\d+(?:-\d+)?-group$/.test(destinatario)) {
    return destinatario;
  }
  if (/^[+\d\s().-]+$/.test(destinatario)) {
    const numero = destinatario.replace(/\D/g, "");
    if (numero.length >= 10 && numero.length <= 15) return numero;
  }
  throw new Error(
    "to deve conter um número de WhatsApp válido com DDI e DDD ou um ID de grupo válido terminado em -group.",
  );
}
