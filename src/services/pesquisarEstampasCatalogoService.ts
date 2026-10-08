import { validarPreferenciasPesquisa } from "@/domain/preferencias-pesquisa-estampas";
import { planejarConsultaEstampas, type CorrespondenciaEstampa } from "@/domain/consulta-profissional-estampas";
import { FILTROS_DESIGN_PESQUISA, normalizarFiltroDesign, normalizarDesignPesquisa, type FiltrosDesignPesquisa } from "@/domain/pesquisa-estampas-design";
import {
  listarFacetasPesquisaEstampas,
  ORDENACOES_PESQUISA_ESTAMPAS,
  pesquisarCatalogoEstampas,
  STATUS_PESQUISA_ESTAMPAS,
  type FacetasPesquisaEstampas,
  type OrdenacaoPesquisaEstampas,
  type StatusPesquisaEstampas,
} from "@/repositories/pesquisa-estampas-repository";
import {
  CONTEUDOS_IMAGEM_ESTAMPA,
  SUPORTES_APLICACAO_ESTAMPA,
  TIPOS_IMAGEM_ESTAMPA,
  type ConteudoImagemEstampa,
  type SuporteAplicacaoEstampa,
  type TipoImagemEstampa,
} from "@/domain/estampa-apresentacao";
import { temFiltroPesquisaEstampas } from "@/services/filtrosPesquisaEstampas";

export type EntradaPesquisaEstampasCatalogo = FiltrosDesignPesquisa & {
  modoCores?: string;
  consulta?: string;
  preferencias?: string[];
  correspondenciaMinima?: number;
  codigo?: string;
  variante?: string;
  tema?: string;
  cores?: string[];
  palavraChave?: string;
  elementoVisual?: string;
  categoria?: string;
  ocasiao?: string;
  publicoSugerido?: string;
  contextoUso?: string;
  afinidadeVisual?: string;
  padraoTextil?: string;
  tipoImagem?: string;
  suporteAplicacao?: string;
  conteudoImagem?: string;
  status?: string;
  ordenacao?: string;
  pagina?: number;
  porPagina?: number;
};

export type EstampaPesquisaCatalogo = {
  id: string;
  codigo: string;
  variante: string | null;
  previewUrl: string | null;
  titulo: string | null;
  descricao: string | null;
  tema: string | null;
  subtemas: string[];
  palavrasChave: string[];
  cores: string[];
  elementosVisuais: string[];
  ocasioes: string[];
  categorias: string[];
  estilo: string | null;
  tipoImagem: TipoImagemEstampa;
  conteudosImagem: ConteudoImagemEstampa[];
  suporteAplicacao: SuporteAplicacaoEstampa;
  descricaoAplicacao: string | null;
  confiancaTipoImagem: number | null;
  publicosSugeridos: string[];
  contextosUso: string[];
  afinidadesVisuais: string[];
  confiancaSegmentacao: number | null;
  segmentacaoBusca: SegmentacaoBuscaDetalhada;
  padroesTexteis: string[];
  confiancaPadraoTextil: number | null;
  classificacaoTextil: ClassificacaoTextilDetalhada;
  processingStatus: StatusPesquisaEstampas;
  processedAt: string | null;
  createdAt: string;
  relevancia: number;
  correspondencia: CorrespondenciaEstampa | null;
  design: ReturnType<typeof normalizarDesignPesquisa>;
};

export type ResultadoPesquisaEstampasCatalogo = {
  estampas: EstampaPesquisaCatalogo[];
  total: number;
  cobertura: { termos: string[]; excluidos: string[]; minima: number; completas: number; parciais: number } | null;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
  ordenacao: OrdenacaoPesquisaEstampas;
};

export async function pesquisarEstampasCatalogo(
  entrada: EntradaPesquisaEstampasCatalogo,
): Promise<ResultadoPesquisaEstampasCatalogo> {
  const design: FiltrosDesignPesquisa = {};
  for (const { campo } of FILTROS_DESIGN_PESQUISA) {
    const valor = texto(entrada[campo], campo, 80);
    if (valor && !normalizarFiltroDesign(campo, valor)) throw new Error(`Filtro de design inválido: ${campo}.`);
    design[campo] = normalizarFiltroDesign(campo, valor);
  }
  const modoCores = validarOpcao(entrada.modoCores, ["TODAS", "QUALQUER"] as const, "Modo de cores inválido.") ?? "TODAS";
  const consulta = texto(entrada.consulta, "consulta", 200);
  planejarConsultaEstampas(consulta);
  const preferencias = validarPreferenciasPesquisa(entrada.preferencias);
  const correspondenciaMinima = inteiro(entrada.correspondenciaMinima ?? 1, "correspondenciaMinima", 1, 100);
  const codigo = texto(entrada.codigo, "codigo", 80);
  const variante = texto(entrada.variante, "variante", 40);
  const tema = texto(entrada.tema, "tema", 120);
  const cores = lista(entrada.cores, "cores", 10, 80);
  const palavraChave = texto(entrada.palavraChave, "palavraChave", 120);
  const elementoVisual = texto(entrada.elementoVisual, "elementoVisual", 120);
  const categoria = texto(entrada.categoria, "categoria", 120);
  const ocasiao = texto(entrada.ocasiao, "ocasiao", 120);
  const publicoSugerido = texto(entrada.publicoSugerido, "publicoSugerido", 80);
  const contextoUso = texto(entrada.contextoUso, "contextoUso", 120);
  const afinidadeVisual = texto(entrada.afinidadeVisual, "afinidadeVisual", 80);
  const padraoTextil = texto(entrada.padraoTextil, "padraoTextil", 80);
  const tipoImagem = validarOpcao(
    entrada.tipoImagem,
    TIPOS_IMAGEM_ESTAMPA,
    "Tipo de imagem inválido.",
  );
  const suporteAplicacao = validarOpcao(
    entrada.suporteAplicacao,
    SUPORTES_APLICACAO_ESTAMPA,
    "Suporte de aplicação inválido.",
  );
  const conteudoImagem = validarOpcao(
    entrada.conteudoImagem,
    CONTEUDOS_IMAGEM_ESTAMPA,
    "Conteúdo de imagem inválido.",
  );
  const status = validarStatus(entrada.status || "COMPLETED");
  if (!temFiltroPesquisaEstampas({
    ...design,
    consulta,
    codigo,
    variante,
    tema,
    cores,
    palavraChave,
    elementoVisual,
    categoria,
    ocasiao,
    publicoSugerido,
    contextoUso,
    afinidadeVisual,
    padraoTextil,
    tipoImagem,
    suporteAplicacao,
    conteudoImagem,
    status: entrada.status,
  })) {
    throw new Error("Informe ao menos um filtro antes de pesquisar.");
  }
  const pagina = inteiro(entrada.pagina ?? 1, "pagina", 1, 1_000_000);
  const porPagina = inteiro(entrada.porPagina ?? 24, "porPagina", 1, 60);
  const ordenacao = validarOrdenacao(
    entrada.ordenacao ?? (consulta || preferencias.some((campo) => campo !== "consulta" && entrada[campo]) ? "RELEVANCIA" : "RECENTES"),
  );
  const resultado = await pesquisarCatalogoEstampas({
    ...design,
    modoCores,
    correspondenciaMinima,
    preferencias,
    consulta,
    codigo,
    variante,
    tema,
    cores,
    palavraChave,
    elementoVisual,
    categoria,
    ocasiao,
    publicoSugerido,
    contextoUso,
    afinidadeVisual,
    padraoTextil,
    tipoImagem,
    suporteAplicacao,
    conteudoImagem,
    status,
    ordenacao,
    limite: porPagina,
    offset: (pagina - 1) * porPagina,
    somenteAtivas: true,
  });
  return {
    estampas: resultado.estampas.map(({ atributosDesign, percentualCorrespondencia, termosEncontrados, termosAusentes, ...estampa }) => ({
      ...estampa,
      design: normalizarDesignPesquisa(atributosDesign),
      correspondencia: resultado.criterios.length ? {
        percentual: Number(percentualCorrespondencia ?? 0),
        termosEncontrados: termosEncontrados ?? [], termosAusentes: termosAusentes ?? [],
      } : null,
      segmentacaoBusca: normalizarSegmentacaoDetalhada(estampa.segmentacaoBusca),
      classificacaoTextil: normalizarClassificacaoTextil(estampa.classificacaoTextil),
      id: estampa.id.toString(),
      processingStatus: validarStatus(estampa.processingStatus) ?? "PENDING",
      processedAt: estampa.processedAt?.toISOString() ?? null,
      createdAt: estampa.createdAt.toISOString(),
      relevancia: Number(estampa.relevancia),
    })),
    total: resultado.total,
    cobertura: resultado.criterios.length ? {
      termos: resultado.criterios, excluidos: resultado.excluidos,
      minima: correspondenciaMinima, completas: resultado.completas, parciais: resultado.parciais,
    } : null,
    pagina,
    porPagina,
    totalPaginas: Math.ceil(resultado.total / porPagina),
    ordenacao,
  };
}

export type SugestaoSegmentacaoDetalhada = {
  termo: string;
  confianca: number;
  evidencias: string[];
};

export type SegmentacaoBuscaDetalhada = {
  publicosSugeridos: SugestaoSegmentacaoDetalhada[];
  contextosUso: SugestaoSegmentacaoDetalhada[];
  afinidadesVisuais: SugestaoSegmentacaoDetalhada[];
};

export type ClassificacaoTextilDetalhada = {
  padroesTexteis: SugestaoSegmentacaoDetalhada[];
};

function normalizarSegmentacaoDetalhada(valor: unknown): SegmentacaoBuscaDetalhada {
  const objeto = objetoDesconhecido(valor);
  return {
    publicosSugeridos: normalizarSugestoes(objeto.publicosSugeridos),
    contextosUso: normalizarSugestoes(objeto.contextosUso),
    afinidadesVisuais: normalizarSugestoes(objeto.afinidadesVisuais),
  };
}

function normalizarClassificacaoTextil(valor: unknown): ClassificacaoTextilDetalhada {
  return {
    padroesTexteis: normalizarSugestoes(objetoDesconhecido(valor).padroesTexteis),
  };
}

function normalizarSugestoes(valor: unknown): SugestaoSegmentacaoDetalhada[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item) => {
    const objeto = objetoDesconhecido(item);
    if (
      typeof objeto.termo !== "string"
      || typeof objeto.confianca !== "number"
      || objeto.confianca < 0
      || objeto.confianca > 1
      || !Array.isArray(objeto.evidencias)
    ) return [];
    return [{
      termo: objeto.termo,
      confianca: objeto.confianca,
      evidencias: objeto.evidencias.filter(
        (evidencia): evidencia is string => typeof evidencia === "string",
      ),
    }];
  });
}

function objetoDesconhecido(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

export async function obterFacetasPesquisaEstampas(status = "COMPLETED"): Promise<FacetasPesquisaEstampas> {
  return listarFacetasPesquisaEstampas(validarStatus(status));
}

function validarStatus(valor: string): StatusPesquisaEstampas | undefined {
  const status = valor.trim().toUpperCase();
  if (status === "TODOS") return undefined;
  if (!STATUS_PESQUISA_ESTAMPAS.includes(status as StatusPesquisaEstampas)) {
    throw new Error("Status de processamento inválido.");
  }
  return status as StatusPesquisaEstampas;
}

function validarOrdenacao(valor: string): OrdenacaoPesquisaEstampas {
  const ordenacao = valor.trim().toUpperCase();
  if (!ORDENACOES_PESQUISA_ESTAMPAS.includes(ordenacao as OrdenacaoPesquisaEstampas)) {
    throw new Error("Ordenação inválida.");
  }
  return ordenacao as OrdenacaoPesquisaEstampas;
}

function texto(valor: string | undefined, campo: string, maximo: number) {
  const normalizado = valor?.trim().replace(/\s+/gu, " ") ?? "";
  if (normalizado.length > maximo) {
    throw new Error(`${campo} deve possuir no máximo ${maximo} caracteres.`);
  }
  return normalizado;
}

function lista(
  valores: string[] | undefined,
  campo: string,
  maximoItens: number,
  maximoCaracteres: number,
) {
  const normalizados = [...new Set((valores ?? []).map((valor) => texto(valor, campo, maximoCaracteres)).filter(Boolean))];
  if (normalizados.length > maximoItens) {
    throw new Error(`${campo} aceita no máximo ${maximoItens} valores.`);
  }
  return normalizados;
}

function inteiro(valor: number, campo: string, minimo: number, maximo: number) {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${campo} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  }
  return valor;
}

function validarOpcao<const T extends readonly string[]>(
  valor: string | undefined,
  opcoes: T,
  mensagem: string,
): T[number] | undefined {
  const normalizado = valor?.trim().toUpperCase();
  if (!normalizado) return undefined;
  if (!opcoes.includes(normalizado as T[number])) throw new Error(mensagem);
  return normalizado as T[number];
}
