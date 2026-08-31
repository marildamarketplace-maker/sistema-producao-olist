import type { AnaliseVisualEstampa } from "@/schemas/analiseVisualEstampaSchema";

export function normalizarTermoTaxonomia(valor: string) {
  return valor
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
}

export function normalizarListaTaxonomia(valores: readonly string[]) {
  const unicos = new Map<string, string>();
  for (const valor of valores) {
    const normalizado = normalizarTermoTaxonomia(valor);
    if (normalizado && !unicos.has(normalizado)) {
      unicos.set(normalizado, normalizado);
    }
  }
  return [...unicos.values()];
}

export function normalizarTaxonomiasAnalise(
  analise: AnaliseVisualEstampa,
): AnaliseVisualEstampa {
  const coresPrincipais = normalizarListaTaxonomia(analise.coresPrincipais);
  const coresPrincipaisSet = new Set(coresPrincipais);
  const coresSecundarias = normalizarListaTaxonomia(
    analise.coresSecundarias,
  ).filter((cor) => !coresPrincipaisSet.has(cor));

  return {
    ...analise,
    tema: normalizarTermoTaxonomia(analise.tema),
    subtemas: normalizarListaTaxonomia(analise.subtemas),
    coresPrincipais,
    coresSecundarias,
    elementosVisuais: normalizarListaTaxonomia(analise.elementosVisuais),
    palavrasChave: normalizarListaTaxonomia(analise.palavrasChave),
    ocasioes: normalizarListaTaxonomia(analise.ocasioes),
    categorias: normalizarListaTaxonomia(analise.categorias),
    estilo: normalizarTermoTaxonomia(analise.estilo),
    aplicacaoVisual: {
      ...analise.aplicacaoVisual,
      evidencias: normalizarListaTaxonomia(
        analise.aplicacaoVisual.evidencias,
      ),
    },
    segmentacaoBusca: {
      publicosSugeridos: normalizarSugestoes(
        analise.segmentacaoBusca.publicosSugeridos,
      ),
      contextosUso: normalizarSugestoes(
        analise.segmentacaoBusca.contextosUso,
      ),
      afinidadesVisuais: normalizarSugestoes(
        analise.segmentacaoBusca.afinidadesVisuais,
      ),
    },
    classificacaoTextil: {
      padroesTexteis: normalizarSugestoes(
        analise.classificacaoTextil.padroesTexteis,
      ),
    },
  };
}

function normalizarSugestoes<
  T extends { termo: string; confianca: number; evidencias: string[] },
>(sugestoes: T[]): T[] {
  return sugestoes.map((sugestao) => ({
    ...sugestao,
    evidencias: normalizarListaTaxonomia(sugestao.evidencias),
  }));
}
