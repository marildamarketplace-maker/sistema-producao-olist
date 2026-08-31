import { expandirTermosPesquisaTaxonomia } from "@/domain/estampa-sinonimos-pesquisa";

export const PADROES_TEXTEIS_ESTAMPA = [
  "poá",
  "floral",
  "folhagem",
  "tropical",
  "listrado",
  "xadrez",
  "vichy",
  "pied-de-poule",
  "chevron",
  "zigue-zague",
  "geométrico",
  "abstrato",
  "paisley",
  "arabesco",
  "damasco",
  "animal print",
  "camuflado",
  "tie-dye",
  "patchwork",
  "étnico",
  "mandala",
] as const;

export type PadraoTextilEstampa = (typeof PADROES_TEXTEIS_ESTAMPA)[number];

const SINONIMOS_TEXTEIS: ReadonlyArray<{
  canonico: PadraoTextilEstampa;
  termos: readonly string[];
}> = [
  { canonico: "poá", termos: ["poá", "poás", "poa", "poas", "bolinha", "bolinhas", "ponto", "pontos", "polka dot", "polka dots"] },
  { canonico: "listrado", termos: ["listrado", "listrada", "listras", "riscas"] },
  { canonico: "xadrez", termos: ["xadrez", "quadriculado", "quadriculada"] },
  { canonico: "vichy", termos: ["vichy", "gingham"] },
  { canonico: "pied-de-poule", termos: ["pied-de-poule", "pied de poule", "houndstooth"] },
  { canonico: "chevron", termos: ["chevron"] },
  { canonico: "zigue-zague", termos: ["zigue-zague", "zigue zague", "zigzag"] },
  { canonico: "paisley", termos: ["paisley", "cashmere", "caxemira"] },
  { canonico: "animal print", termos: ["animal print", "oncinha", "leopardo", "zebra", "zebrado", "cobra"] },
  { canonico: "camuflado", termos: ["camuflado", "camuflagem"] },
  { canonico: "tie-dye", termos: ["tie-dye", "tie dye"] },
  { canonico: "damasco", termos: ["damasco", "adamascado", "adamascada"] },
];

const removerAcentos = (valor: string) =>
  valor.normalize("NFD").replace(/[\u0300-\u036f]/gu, "");

const normalizar = (valor: string) =>
  removerAcentos(valor).trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");

const sinonimosPorTermo = new Map<string, readonly string[]>();
for (const grupo of SINONIMOS_TEXTEIS) {
  const termos = [...new Set([grupo.canonico, ...grupo.termos])];
  for (const termo of termos) sinonimosPorTermo.set(normalizar(termo), termos);
}

export function expandirConsultaComVocabularioTextil(consulta: string) {
  const normalizada = consulta.trim().replace(/\s+/gu, " ");
  if (!normalizada) return "";

  const grupoCompleto = sinonimosPorTermo.get(normalizar(normalizada));
  if (grupoCompleto) return agruparTermosWebsearch(grupoCompleto);

  const tokens = normalizada.split(" ");
  return tokens
    .map((token) => {
      const sinonimos = sinonimosPorTermo.get(normalizar(token));
      return sinonimos ? `(${agruparTermosWebsearch(sinonimos)})` : escaparTermoWebsearch(token);
    })
    .join(" ");
}

export function expandirPadroesTexteisParaPesquisa(padroes: readonly string[]) {
  return expandirTermosPesquisaTaxonomia(padroes);
}

function agruparTermosWebsearch(termos: readonly string[]) {
  return [...new Set(termos.map(escaparTermoWebsearch))].join(" OR ");
}

function escaparTermoWebsearch(termo: string) {
  return `"${termo.replace(/["\\]/gu, " ").trim()}"`;
}
