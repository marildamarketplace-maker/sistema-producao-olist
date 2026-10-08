import { validarPreferenciasPesquisa, CRITERIOS_FLEXIVEIS_ESTAMPAS } from "@/domain/preferencias-pesquisa-estampas";
import { FILTROS_DESIGN_PESQUISA, normalizarFiltroDesign, type FiltrosDesignPesquisa } from "@/domain/pesquisa-estampas-design";
import {
  CONTEUDOS_IMAGEM_ESTAMPA,
  SUPORTES_APLICACAO_ESTAMPA,
  TIPOS_IMAGEM_ESTAMPA,
  type ConteudoImagemEstampa,
  type SuporteAplicacaoEstampa,
  type TipoImagemEstampa,
} from "@/domain/estampa-apresentacao";

export const STATUS_FILTRO_PESQUISA_ESTAMPAS = [
  "",
  "TODOS",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

export const ORDENACOES_URL_PESQUISA_ESTAMPAS = [
  "RELEVANCIA",
  "RECENTES",
  "CODIGO_ASC",
  "CODIGO_DESC",
] as const;

export type StatusFiltroPesquisaEstampas =
  (typeof STATUS_FILTRO_PESQUISA_ESTAMPAS)[number];
export type OrdenacaoUrlPesquisaEstampas =
  (typeof ORDENACOES_URL_PESQUISA_ESTAMPAS)[number];

export type FiltrosPesquisaEstampasPreenchidos = FiltrosDesignPesquisa & {
  modoCores?: string;
  consulta?: string;
  codigo?: string;
  variante?: string;
  tema?: string;
  cores?: readonly string[];
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
};

export type FiltrosPesquisaEstampasUrl = {
  estilo: string;
  distribuicao: string;
  orientacao: string;
  densidade: string;
  linguagemVisual: string;
  aplicacaoSugerida: string;
  modoCores: "TODAS" | "QUALQUER";
  correspondenciaMinima: number;
  preferencias: string[];
  consulta: string;
  codigo: string;
  variante: string;
  tema: string;
  cores: string[];
  palavraChave: string;
  elementoVisual: string;
  categoria: string;
  ocasiao: string;
  publicoSugerido: string;
  contextoUso: string;
  afinidadeVisual: string;
  padraoTextil: string;
  tipoImagem: "" | TipoImagemEstampa;
  suporteAplicacao: "" | SuporteAplicacaoEstampa;
  conteudoImagem: "" | ConteudoImagemEstampa;
  status: StatusFiltroPesquisaEstampas;
};

export type EstadoUrlPesquisaEstampas = {
  filtros: FiltrosPesquisaEstampasUrl;
  pagina: number;
  porPagina: number;
  ordenacao: OrdenacaoUrlPesquisaEstampas;
};

type LeitorParametros = Pick<URLSearchParams, "get" | "getAll">;

export const FILTROS_VAZIOS_PESQUISA_ESTAMPAS: FiltrosPesquisaEstampasUrl = {
  estilo: "",
  distribuicao: "",
  orientacao: "",
  densidade: "",
  linguagemVisual: "",
  aplicacaoSugerida: "",
  modoCores: "TODAS",
  correspondenciaMinima: 1,
  preferencias: ["consulta"],
  consulta: "",
  codigo: "",
  variante: "",
  tema: "",
  cores: [],
  palavraChave: "",
  elementoVisual: "",
  categoria: "",
  ocasiao: "",
  publicoSugerido: "",
  contextoUso: "",
  afinidadeVisual: "",
  padraoTextil: "",
  tipoImagem: "",
  suporteAplicacao: "",
  conteudoImagem: "",
  status: "",
};

export function temFiltroPesquisaEstampas(
  filtros: FiltrosPesquisaEstampasPreenchidos,
) {
  const status = filtros.status?.trim().toUpperCase();
  return Boolean(
    FILTROS_DESIGN_PESQUISA.some(({ campo }) => filtros[campo]?.trim())
    || filtros.consulta?.trim()
    || filtros.codigo?.trim()
    || filtros.variante?.trim()
    || filtros.tema?.trim()
    || filtros.cores?.some((cor) => cor.trim())
    || filtros.palavraChave?.trim()
    || filtros.elementoVisual?.trim()
    || filtros.categoria?.trim()
    || filtros.ocasiao?.trim()
    || filtros.publicoSugerido?.trim()
    || filtros.contextoUso?.trim()
    || filtros.afinidadeVisual?.trim()
    || filtros.padraoTextil?.trim()
    || filtros.tipoImagem?.trim()
    || filtros.suporteAplicacao?.trim()
    || filtros.conteudoImagem?.trim()
    || (status && status !== "TODOS")
  );
}

export function lerEstadoUrlPesquisaEstampas(
  parametros: LeitorParametros,
): EstadoUrlPesquisaEstampas {
  const consulta = textoParametro(parametros.get("q"));
  const filtros: FiltrosPesquisaEstampasUrl = {
    estilo: normalizarFiltroDesign("estilo", parametros.get("estilo")),
    distribuicao: normalizarFiltroDesign("distribuicao", parametros.get("distribuicao")),
    orientacao: normalizarFiltroDesign("orientacao", parametros.get("orientacao")),
    densidade: normalizarFiltroDesign("densidade", parametros.get("densidade")),
    linguagemVisual: normalizarFiltroDesign("linguagemVisual", parametros.get("linguagemVisual")),
    aplicacaoSugerida: normalizarFiltroDesign("aplicacaoSugerida", parametros.get("aplicacaoSugerida")),
    modoCores: opcaoParametro(parametros.get("modoCores"), ["TODAS", "QUALQUER"] as const) || "TODAS",
    preferencias: parametros.get("preferencias") === null ? ["consulta"] : [...new Set((parametros.get("preferencias") ?? "").split(",").filter((campo) => Object.hasOwn(CRITERIOS_FLEXIVEIS_ESTAMPAS, campo)))],
    correspondenciaMinima: inteiroPositivoParametro(parametros.get("correspondenciaMinima"), 1, 100),
    consulta,
    codigo: textoParametro(parametros.get("codigo")),
    variante: textoParametro(parametros.get("variante")),
    tema: textoParametro(parametros.get("tema")),
    cores: [...new Set(parametros.getAll("cor").map(textoParametro).filter(Boolean))],
    palavraChave: textoParametro(parametros.get("palavraChave")),
    elementoVisual: textoParametro(parametros.get("elementoVisual")),
    categoria: textoParametro(parametros.get("categoria")),
    ocasiao: textoParametro(parametros.get("ocasiao")),
    publicoSugerido: textoParametro(parametros.get("publicoSugerido")),
    contextoUso: textoParametro(parametros.get("contextoUso")),
    afinidadeVisual: textoParametro(parametros.get("afinidadeVisual")),
    padraoTextil: textoParametro(parametros.get("padraoTextil")),
    tipoImagem: opcaoParametro(parametros.get("tipoImagem"), TIPOS_IMAGEM_ESTAMPA),
    suporteAplicacao: opcaoParametro(
      parametros.get("suporteAplicacao"),
      SUPORTES_APLICACAO_ESTAMPA,
    ),
    conteudoImagem: opcaoParametro(
      parametros.get("conteudoImagem"),
      CONTEUDOS_IMAGEM_ESTAMPA,
    ),
    status: opcaoParametro(
      parametros.get("status"),
      STATUS_FILTRO_PESQUISA_ESTAMPAS,
    ),
  };
  return {
    filtros,
    pagina: inteiroPositivoParametro(parametros.get("pagina"), 1, 1_000_000),
    porPagina: inteiroPositivoParametro(parametros.get("porPagina"), 24, 60),
    ordenacao: opcaoParametro(
      parametros.get("ordenacao"),
      ORDENACOES_URL_PESQUISA_ESTAMPAS,
    ) || (consulta || filtros.preferencias.some((campo) => campo !== "consulta" && (Array.isArray(filtros[campo as keyof typeof filtros]) ? (filtros[campo as keyof typeof filtros] as string[]).length > 0 : Boolean(filtros[campo as keyof typeof filtros]))) ? "RELEVANCIA" : "RECENTES"),
  };
}

export function criarQueryPesquisaEstampas(
  filtros: FiltrosPesquisaEstampasUrl,
  pagina: number,
  ordenacao: OrdenacaoUrlPesquisaEstampas,
  porPagina = 24,
) {
  const parametros = new URLSearchParams({
    pagina: String(inteiroPositivoParametro(String(pagina), 1, 1_000_000)),
    porPagina: String(inteiroPositivoParametro(String(porPagina), 24, 60)),
    ordenacao,
    preferencias: validarPreferenciasPesquisa(filtros.preferencias).join(","),
    correspondenciaMinima: String(inteiroPositivoParametro(String(filtros.correspondenciaMinima), 1, 100)),
  });
  const campos: Array<[string, string]> = [
    ...FILTROS_DESIGN_PESQUISA.map(({ campo }): [string, string] => [campo, filtros[campo]]),
    ["modoCores", filtros.modoCores],
    ["q", filtros.consulta],
    ["codigo", filtros.codigo],
    ["variante", filtros.variante],
    ["tema", filtros.tema],
    ["palavraChave", filtros.palavraChave],
    ["elementoVisual", filtros.elementoVisual],
    ["categoria", filtros.categoria],
    ["ocasiao", filtros.ocasiao],
    ["publicoSugerido", filtros.publicoSugerido],
    ["contextoUso", filtros.contextoUso],
    ["afinidadeVisual", filtros.afinidadeVisual],
    ["padraoTextil", filtros.padraoTextil],
    ["tipoImagem", filtros.tipoImagem],
    ["conteudoImagem", filtros.conteudoImagem],
    ["suporteAplicacao", filtros.suporteAplicacao],
    ["status", filtros.status],
  ];
  for (const [nome, valor] of campos) {
    const normalizado = valor.trim();
    if (normalizado) parametros.set(nome, normalizado);
  }
  for (const cor of new Set(filtros.cores.map(textoParametro))) {
    const normalizada = cor.trim();
    if (normalizada) parametros.append("cor", normalizada);
  }
  return parametros;
}

export function copiarFiltrosPesquisaEstampas(
  filtros: FiltrosPesquisaEstampasUrl,
): FiltrosPesquisaEstampasUrl {
  return { ...filtros, cores: [...filtros.cores], preferencias: [...filtros.preferencias] };
}

function textoParametro(valor: string | null) {
  return valor?.trim().replace(/\s+/gu, " ") ?? "";
}

function inteiroPositivoParametro(valor: string | null, fallback: number, maximo: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 && numero <= maximo ? numero : fallback;
}

function opcaoParametro<const T extends readonly string[]>(
  valor: string | null,
  opcoes: T,
): T[number] | "" {
  const normalizado = textoParametro(valor).toUpperCase();
  return opcoes.includes(normalizado as T[number]) ? normalizado as T[number] : "";
}
