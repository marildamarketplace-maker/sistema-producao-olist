export const MAX_TENTATIVAS_NOTIFICATION = 3;

export type NotificationStatusAposFalha = "PENDENTE" | "ERRO";

export function obterStatusNotificationAposFalha(
  tentativas: number,
): NotificationStatusAposFalha {
  if (!Number.isInteger(tentativas) || tentativas < 1) {
    throw new Error("tentativas deve ser um inteiro maior que zero.");
  }

  return tentativas >= MAX_TENTATIVAS_NOTIFICATION ? "ERRO" : "PENDENTE";
}
