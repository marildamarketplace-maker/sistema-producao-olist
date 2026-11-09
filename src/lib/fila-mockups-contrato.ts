export const MAX_ESTAMPAS_MOCKUPS = 60;
export const MAX_MODELOS_MOCKUPS = 24;
export const MAX_ESTAMPAS_LAYOUT = 4;
export const MAX_SAIDAS_MOCKUPS = 500;

export type TrabalhoMockup = { mockupId: string; estampaIds: string[] };
export type EstampaSelecionadaMockup = { id: string; codigo: string };

export function alternarSelecao<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor];
}
