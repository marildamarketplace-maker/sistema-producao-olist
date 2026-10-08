import {
  APLICACOES_DESIGN, DENSIDADES_DESIGN, DISTRIBUICOES_DESIGN,
  ESTILOS_DESIGN, LINGUAGENS_DESIGN, ORIENTACOES_DESIGN,
} from "@/domain/estampa-atributos-design";

export const CONFIANCA_MINIMA_APLICACAO_PESQUISA = 0.7;

export const FILTROS_DESIGN_PESQUISA = [
  { campo: "estilo", faceta: "estilos", rotulo: "Estilo", opcoes: ESTILOS_DESIGN },
  { campo: "distribuicao", faceta: "distribuicoes", rotulo: "Distribuição", opcoes: DISTRIBUICOES_DESIGN },
  { campo: "orientacao", faceta: "orientacoes", rotulo: "Orientação", opcoes: ORIENTACOES_DESIGN },
  { campo: "densidade", faceta: "densidades", rotulo: "Densidade", opcoes: DENSIDADES_DESIGN },
  { campo: "linguagemVisual", faceta: "linguagensVisuais", rotulo: "Linguagem visual", opcoes: LINGUAGENS_DESIGN },
  { campo: "aplicacaoSugerida", faceta: "aplicacoesSugeridas", rotulo: "Aplicação sugerida", opcoes: APLICACOES_DESIGN },
] as const;

export type CampoDesignPesquisa = (typeof FILTROS_DESIGN_PESQUISA)[number]["campo"];
export type FiltrosDesignPesquisa = Partial<Record<CampoDesignPesquisa, string>>;
export type FacetasDesignPesquisa = Record<(typeof FILTROS_DESIGN_PESQUISA)[number]["faceta"], string[]>;

export function normalizarFiltroDesign(campo: CampoDesignPesquisa, valor: string | null | undefined) {
  const normalizado = valor?.trim().toLocaleLowerCase("pt-BR") ?? "";
  const opcoes: readonly string[] = FILTROS_DESIGN_PESQUISA.find((filtro) => filtro.campo === campo)!.opcoes;
  return opcoes.includes(normalizado) ? normalizado : "";
}

export function normalizarDesignPesquisa(valor: unknown) {
  const resposta = objeto(valor);
  const composicao = objeto(resposta.composicaoVisual);
  const lista = (atributo: unknown, opcoes: readonly string[]) => {
    const dados = objeto(atributo);
    return dados.estado === "IDENTIFICADO" && Array.isArray(dados.valores)
      ? [...new Set(dados.valores.filter((item): item is string => typeof item === "string" && opcoes.includes(item)))]
      : [];
  };
  const aplicacoes = objeto(resposta.aplicacoesSugeridas);
  const sugestoes = aplicacoes.estado === "IDENTIFICADO" && Array.isArray(aplicacoes.sugestoes)
    ? aplicacoes.sugestoes.flatMap((item) => {
      const sugestao = objeto(item);
      if (typeof sugestao.termo !== "string" || !(APLICACOES_DESIGN as readonly string[]).includes(sugestao.termo)
        || typeof sugestao.confianca !== "number" || !Number.isFinite(sugestao.confianca)
        || sugestao.confianca < CONFIANCA_MINIMA_APLICACAO_PESQUISA || sugestao.confianca > 1) return [];
      return [{ termo: sugestao.termo, confianca: sugestao.confianca,
        evidencias: Array.isArray(sugestao.evidencias) ? sugestao.evidencias.filter((e): e is string => typeof e === "string") : [] }];
    }) : [];
  return {
    distribuicoes: lista(composicao.distribuicao, DISTRIBUICOES_DESIGN),
    orientacoes: lista(composicao.orientacao, ORIENTACOES_DESIGN),
    densidades: lista(composicao.densidade, DENSIDADES_DESIGN),
    linguagensVisuais: lista(resposta.linguagemVisual, LINGUAGENS_DESIGN),
    aplicacoesSugeridas: sugestoes,
  };
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}
