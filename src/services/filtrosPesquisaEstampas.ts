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

export type FiltrosPesquisaEstampasPreenchidos = {
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
  ordenacao: OrdenacaoUrlPesquisaEstampas;
};

type LeitorParametros = Pick<URLSearchParams, "get" | "getAll">;

export const FILTROS_VAZIOS_PESQUISA_ESTAMPAS: FiltrosPesquisaEstampasUrl = {
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
    filtros.consulta?.trim()
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
    pagina: inteiroPositivoParametro(parametros.get("pagina"), 1),
    ordenacao: opcaoParametro(
      parametros.get("ordenacao"),
      ORDENACOES_URL_PESQUISA_ESTAMPAS,
    ) || (consulta ? "RELEVANCIA" : "RECENTES"),
  };
}

export function criarQueryPesquisaEstampas(
  filtros: FiltrosPesquisaEstampasUrl,
  pagina: number,
  ordenacao: OrdenacaoUrlPesquisaEstampas,
) {
  const parametros = new URLSearchParams({
    pagina: String(Math.max(1, Math.trunc(pagina))),
    porPagina: "24",
    ordenacao,
  });
  const campos: Array<[string, string]> = [
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
  for (const cor of filtros.cores) {
    const normalizada = cor.trim();
    if (normalizada) parametros.append("cor", normalizada);
  }
  return parametros;
}

export function copiarFiltrosPesquisaEstampas(
  filtros: FiltrosPesquisaEstampasUrl,
): FiltrosPesquisaEstampasUrl {
  return { ...filtros, cores: [...filtros.cores] };
}

function textoParametro(valor: string | null) {
  return valor?.trim().replace(/\s+/gu, " ") ?? "";
}

function inteiroPositivoParametro(valor: string | null, fallback: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : fallback;
}

function opcaoParametro<const T extends readonly string[]>(
  valor: string | null,
  opcoes: T,
): T[number] | "" {
  const normalizado = textoParametro(valor).toUpperCase();
  return opcoes.includes(normalizado as T[number]) ? normalizado as T[number] : "";
}
