export const MOCKUP_MAX_BYTES = 4 * 1024 * 1024;
export const MOCKUP_FORMATOS = "image/jpeg,image/png,image/webp";
export const MOCKUP_NOME_MAX = 100;

export type TipoMockup = "INDIVIDUAL" | "LAYOUT";
export type Mockup = { id: string; nome: string; tipo: TipoMockup };

export function interpretarIdMockup(id: string): { tipo: TipoMockup; nomeCodificado: string } | null {
  const match = /^(layout-)?[a-f0-9]{64}-([A-Za-z0-9_-]{1,536})$/.exec(id);
  if (!match) return null;
  return { tipo: match[1] ? "LAYOUT" : "INDIVIDUAL", nomeCodificado: match[2] };
}
