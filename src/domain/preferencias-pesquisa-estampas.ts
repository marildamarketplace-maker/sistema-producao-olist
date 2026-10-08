export const CRITERIOS_FLEXIVEIS_ESTAMPAS = {
  consulta: "Pesquisa geral", tema: "Tema", cores: "Cores", palavraChave: "Palavra-chave",
  elementoVisual: "Elemento visual", categoria: "Categoria", ocasiao: "Ocasião",
  publicoSugerido: "Público", contextoUso: "Contexto", afinidadeVisual: "Afinidade",
  padraoTextil: "Padrão têxtil", estilo: "Estilo", distribuicao: "Distribuição",
  orientacao: "Orientação", densidade: "Densidade", linguagemVisual: "Linguagem visual",
  aplicacaoSugerida: "Aplicação sugerida", tipoImagem: "Tipo de imagem",
  suporteAplicacao: "Suporte", conteudoImagem: "Conteúdo",
} as const;
export type CampoPreferenciaEstampa = keyof typeof CRITERIOS_FLEXIVEIS_ESTAMPAS;

export function validarPreferenciasPesquisa(preferencias: string[] = ["consulta"]): CampoPreferenciaEstampa[] {
  if (preferencias.length > Object.keys(CRITERIOS_FLEXIVEIS_ESTAMPAS).length
    || preferencias.some((campo) => !Object.hasOwn(CRITERIOS_FLEXIVEIS_ESTAMPAS, campo))) {
    throw new Error("Preferências inválidas. Código, variante e status são sempre obrigatórios.");
  }
  return [...new Set(preferencias)] as CampoPreferenciaEstampa[];
}
