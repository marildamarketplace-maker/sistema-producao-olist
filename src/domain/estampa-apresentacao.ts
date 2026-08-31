export const TIPOS_IMAGEM_ESTAMPA = [
  "ESTAMPA",
  "LAYOUT",
  "APLICACAO_PRODUTO",
  "INDEFINIDO",
] as const;

export type TipoImagemEstampa = (typeof TIPOS_IMAGEM_ESTAMPA)[number];

export const ROTULOS_TIPO_IMAGEM_ESTAMPA: Record<TipoImagemEstampa, string> = {
  ESTAMPA: "Estampa plana",
  LAYOUT: "Layout composto",
  APLICACAO_PRODUTO: "Aplicação no produto",
  INDEFINIDO: "Não classificado",
};

export const CONTEUDOS_IMAGEM_ESTAMPA = [
  "ESTAMPA",
  "APLICACAO_PRODUTO",
  "MODELO_REAL",
  "MANEQUIM",
  "PRODUTO_ISOLADO",
  "AMBIENTE",
  "TEXTO",
  "VARIANTES",
  "OUTRO",
] as const;

export type ConteudoImagemEstampa = (typeof CONTEUDOS_IMAGEM_ESTAMPA)[number];

export const ROTULOS_CONTEUDO_IMAGEM_ESTAMPA: Record<ConteudoImagemEstampa, string> = {
  ESTAMPA: "Arte da estampa",
  APLICACAO_PRODUTO: "Aplicação no produto",
  MODELO_REAL: "Pessoa/modelo real",
  MANEQUIM: "Manequim",
  PRODUTO_ISOLADO: "Produto isolado",
  AMBIENTE: "Ambiente",
  TEXTO: "Texto",
  VARIANTES: "Variantes",
  OUTRO: "Outro",
};

export const SUPORTES_APLICACAO_ESTAMPA = [
  "MODELO_REAL",
  "MANEQUIM",
  "PRODUTO_ISOLADO",
  "AMBIENTE",
  "MISTO",
  "OUTRO",
  "NAO_APLICAVEL",
] as const;

export type SuporteAplicacaoEstampa =
  (typeof SUPORTES_APLICACAO_ESTAMPA)[number];

export const ROTULOS_SUPORTE_APLICACAO_ESTAMPA: Record<SuporteAplicacaoEstampa, string> = {
  MODELO_REAL: "Pessoa/modelo real",
  MANEQUIM: "Manequim",
  PRODUTO_ISOLADO: "Produto isolado",
  AMBIENTE: "Aplicação em ambiente",
  MISTO: "Aplicações mistas",
  OUTRO: "Outro suporte",
  NAO_APLICAVEL: "Sem aplicação",
};

export const CONTEUDO_POR_SUPORTE_APLICACAO: Readonly<
  Partial<Record<SuporteAplicacaoEstampa, ConteudoImagemEstampa>>
> = {
  MODELO_REAL: "MODELO_REAL",
  MANEQUIM: "MANEQUIM",
  PRODUTO_ISOLADO: "PRODUTO_ISOLADO",
  AMBIENTE: "AMBIENTE",
};
