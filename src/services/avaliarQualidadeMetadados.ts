import type { AnaliseVisualEstampa } from "@/schemas/analiseVisualEstampaSchema";

export type ProblemaQualidadeMetadados = {
  codigo: "CAMPO_ESSENCIAL_VAZIO" | "PALAVRA_CHAVE_GENERICA" | "SUGESTAO_SEM_EVIDENCIA" | "PADRAO_TEXTIL_AUSENTE" | "PADRAO_TEXTIL_INCOMPATIVEL" | "APRESENTACAO_CONTRADITORIA";
  propriedade: string;
  motivo: string;
};

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase();
const genericos = new Set(["estampa", "estampas", "padrao", "padroes", "design", "imagem", "arte"]);
// Apenas nomes explícitos de padrões. Não deduzimos padrão a partir de um
// objeto isolado (uma flor, um círculo ou uma palmeira).
const padroesPorNome = new Map([
  ["floral", "floral"], ["poa", "poá"], ["vichy", "vichy"],
  ["listrado", "listrado"], ["xadrez", "xadrez"], ["paisley", "paisley"],
  ["animal print", "animal print"], ["geometrico", "geométrico"], ["abstrato", "abstrato"],
]);

export function avaliarQualidadeMetadados(analise: AnaliseVisualEstampa) {
  const problemas: ProblemaQualidadeMetadados[] = [];
  const adicionar = (codigo: ProblemaQualidadeMetadados["codigo"], propriedade: string, motivo: string) => {
    problemas.push({ codigo, propriedade, motivo });
  };
  for (const campo of ["titulo", "descricao", "tema", "estilo"] as const) {
    if (!analise[campo].trim()) adicionar("CAMPO_ESSENCIAL_VAZIO", campo, "Campo essencial sem conteúdo.");
  }
  for (const campo of ["coresPrincipais", "elementosVisuais", "palavrasChave", "categorias", "conteudosImagem"] as const) {
    if (!analise[campo].length) adicionar("CAMPO_ESSENCIAL_VAZIO", campo, "Lista essencial sem conteúdo.");
  }
  analise.palavrasChave.forEach((termo, indice) => {
    if (genericos.has(normalizar(termo))) adicionar("PALAVRA_CHAVE_GENERICA", `palavrasChave.${indice}`, `Termo genérico sem poder de diferenciação: ${termo}.`);
  });
  const grupos = {
    "classificacaoTextil.padroesTexteis": analise.classificacaoTextil.padroesTexteis,
    "segmentacaoBusca.publicosSugeridos": analise.segmentacaoBusca.publicosSugeridos,
    "segmentacaoBusca.contextosUso": analise.segmentacaoBusca.contextosUso,
    "segmentacaoBusca.afinidadesVisuais": analise.segmentacaoBusca.afinidadesVisuais,
  };
  for (const [campo, sugestoes] of Object.entries(grupos)) {
    sugestoes.forEach((sugestao, indice) => {
      if (!sugestao.evidencias.some(evidencia => evidencia.trim())) adicionar("SUGESTAO_SEM_EVIDENCIA", `${campo}.${indice}`, `Classificação ${sugestao.termo} sem evidência registrada.`);
    });
  }
  const esperado = padroesPorNome.get(normalizar(analise.tema));
  const padroes = analise.classificacaoTextil.padroesTexteis.map(item => normalizar(item.termo));
  const motivosDescritos = normalizar([analise.titulo, analise.descricao, ...analise.elementosVisuais].join(" "));
  if (!esperado && !padroes.length && /\b(?:floral|poa|vichy|paisley|animal print|padrao listrado|padrao xadrez)\b/u.test(motivosDescritos)) {
    adicionar("PADRAO_TEXTIL_AUSENTE", "classificacaoTextil.padroesTexteis", "Padrão têxtil explicitamente descrito sem classificação registrada.");
  }
  // Subtipos válidos: vichy é xadrez; poá e listrado podem ser geométricos.
  const compativeis = esperado === "geométrico" ? ["geometrico", "poa", "listrado", "xadrez", "vichy", "chevron", "zigue-zague", "pied-de-poule"]
    : esperado === "xadrez" ? ["xadrez", "vichy", "pied-de-poule"] : esperado ? [normalizar(esperado)] : [];
  if (esperado && !padroes.some(padrao => compativeis.includes(padrao))) {
    adicionar(padroes.length ? "PADRAO_TEXTIL_INCOMPATIVEL" : "PADRAO_TEXTIL_AUSENTE", "classificacaoTextil.padroesTexteis", `Tema ${analise.tema} sem classificação têxtil correspondente.`);
  }
  if (analise.tipoImagem === "ESTAMPA" && (analise.aplicacaoVisual.presente || analise.aplicacaoVisual.objetoFisicoVisivel || analise.conteudosImagem.includes("APLICACAO_PRODUTO"))) {
    adicionar("APRESENTACAO_CONTRADITORIA", "tipoImagem", "Arte plana registra aplicação ou objeto físico.");
  }
  if (analise.tipoImagem === "APLICACAO_PRODUTO" && !analise.aplicacaoVisual.presente) {
    adicionar("APRESENTACAO_CONTRADITORIA", "aplicacaoVisual.presente", "Apresentação de produto sem aplicação registrada.");
  }
  // Sinais explícitos de apresentação na descrição, evitando inferir objetos
  // a partir de palavras ambíguas como textura, sombra ou tecido.
  if (analise.tipoImagem === "ESTAMPA" && /\b(?:modelo real|manequim|pessoa fotografada|vestido com caimento)\b/u.test(normalizar(analise.descricao))) {
    adicionar("APRESENTACAO_CONTRADITORIA", "descricao", "Descrição registra suporte físico, mas apresentação informa arte plana.");
  }
  return { versao: "qualidade-metadados-v1", status: problemas.length ? "PRECISA_REVISAO" : "APROVADO", precisaRevisao: problemas.length > 0, problemas };
}
