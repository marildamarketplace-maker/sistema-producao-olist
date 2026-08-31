type GrupoSinonimos = readonly [string, ...string[]];

const GRUPOS_SINONIMOS: readonly GrupoSinonimos[] = [
  ["poá", "poa", "poás", "poas", "bolinha", "bolinhas", "ponto", "pontos", "polka dot", "polka dots"],
  ["listrado", "listrada", "listras", "riscas"],
  ["xadrez", "quadriculado", "quadriculada"],
  ["vichy", "gingham"],
  ["pied-de-poule", "pied de poule", "houndstooth"],
  ["zigue-zague", "zigue zague", "zigzag"],
  ["paisley", "cashmere", "caxemira"],
  ["animal print", "estampa animal"],
  ["camuflado", "camuflagem"],
  ["tie-dye", "tie dye"],
  ["dourado", "ouro"],
  ["prateado", "prata"],
  ["azul marinho", "marinho"],
] as const;

const indiceSinonimos = new Map<string, readonly string[]>();
for (const grupo of GRUPOS_SINONIMOS) {
  const termos = [...new Set(grupo.map(normalizarTermoBusca))];
  for (const termo of termos) indiceSinonimos.set(termo, termos);
}

export function expandirTermosPesquisaTaxonomia(termos: readonly string[]) {
  const resultado: string[] = [];
  const vistos = new Set<string>();
  for (const termo of termos) {
    const normalizado = normalizarTermoBusca(termo);
    if (!normalizado) continue;
    const expansao = indiceSinonimos.get(normalizado) ?? [normalizado];
    for (const item of expansao) {
      if (vistos.has(item)) continue;
      vistos.add(item);
      resultado.push(item);
    }
  }
  return resultado;
}

export function normalizarTermoBusca(valor: string) {
  return valor
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
}
