export type DadosTextoPesquisa = {
  codigo?: string | null;
  variante?: string | null;
  titulo?: string | null;
  descricao?: string | null;
  tema?: string | null;
  subtemas?: string[] | string | null;
  palavrasChave?: string[] | string | null;
  cores?: string[] | string | null;
  coresPrincipais?: string[] | string | null;
  coresSecundarias?: string[] | string | null;
  elementosVisuais?: string[] | string | null;
  ocasioes?: string[] | string | null;
  categorias?: string[] | string | null;
  estilo?: string | null;
  tipoImagem?: string | null;
  conteudosImagem?: string[] | string | null;
  suporteAplicacao?: string | null;
  descricaoAplicacao?: string | null;
  publicosSugeridos?: string[] | string | null;
  contextosUso?: string[] | string | null;
  afinidadesVisuais?: string[] | string | null;
  padroesTexteis?: string[] | string | null;
};

const normalizarEspacos = (valor: string) => valor.trim().replace(/\s+/g, " ");

const chaveDeDuplicacao = (valor: string) =>
  normalizarEspacos(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

function paraLista(valor: string[] | string | null | undefined): string[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor !== "string") return [];

  // Campos legados podem armazenar listas como texto separado por vírgula,
  // ponto e vírgula ou quebra de linha.
  return valor.split(/[,;\n]+/u);
}

export function construirTextoPesquisa(dados: DadosTextoPesquisa): string {
  const termosTaxonomia = expandirTermosPesquisaTaxonomia([
    ...paraLista(dados.padroesTexteis),
    ...paraLista(dados.cores),
    ...paraLista(dados.coresPrincipais),
    ...paraLista(dados.coresSecundarias),
  ]);
  const candidatos = [
    dados.codigo,
    dados.variante,
    dados.titulo,
    dados.descricao,
    dados.tema,
    ...paraLista(dados.subtemas),
    ...paraLista(dados.palavrasChave),
    ...paraLista(dados.cores),
    ...paraLista(dados.coresPrincipais),
    ...paraLista(dados.coresSecundarias),
    ...paraLista(dados.elementosVisuais),
    ...paraLista(dados.ocasioes),
    ...paraLista(dados.categorias),
    dados.estilo,
    dados.tipoImagem,
    ...paraLista(dados.conteudosImagem),
    dados.suporteAplicacao,
    dados.descricaoAplicacao,
    ...paraLista(dados.publicosSugeridos),
    ...paraLista(dados.contextosUso),
    ...paraLista(dados.afinidadesVisuais),
    ...paraLista(dados.padroesTexteis),
    ...termosTaxonomia,
  ];

  const vistos = new Set<string>();
  const termos: string[] = [];

  for (const candidato of candidatos) {
    if (typeof candidato !== "string") continue;
    const termo = normalizarEspacos(candidato);
    if (!termo) continue;

    const chave = chaveDeDuplicacao(termo);
    if (vistos.has(chave)) continue;

    vistos.add(chave);
    termos.push(termo);
  }

  return termos.join(" ");
}
import { expandirTermosPesquisaTaxonomia } from "@/domain/estampa-sinonimos-pesquisa";
