export const PUBLICOS_SUGERIDOS_ESTAMPA = [
  "geral",
  "infantil",
  "juvenil",
  "adulto",
  "familiar",
] as const;

export type PublicoSugeridoEstampa =
  (typeof PUBLICOS_SUGERIDOS_ESTAMPA)[number];

export const CONTEXTOS_USO_ESTAMPA = [
  "decoração",
  "festas e eventos",
  "campanhas de conscientização",
  "ambiente escolar",
  "contexto religioso ou devocional",
  "eventos esportivos",
  "uso corporativo",
] as const;

export type ContextoUsoEstampa = (typeof CONTEXTOS_USO_ESTAMPA)[number];

export const AFINIDADES_VISUAIS_ESTAMPA = [
  "delicado",
  "romântico",
  "country",
  "rústico",
  "geek",
  "esportivo",
  "clássico",
  "lúdico",
] as const;

export type AfinidadeVisualEstampa =
  (typeof AFINIDADES_VISUAIS_ESTAMPA)[number];

