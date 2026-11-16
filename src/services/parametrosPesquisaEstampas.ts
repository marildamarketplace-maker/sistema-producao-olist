import { FILTROS_DESIGN_PESQUISA } from "@/domain/pesquisa-estampas-design";

export function entradaParametrosEstampas(params: URLSearchParams) {
  return {
    ...Object.fromEntries(FILTROS_DESIGN_PESQUISA.map(({ campo }) => [campo, params.get(campo) ?? undefined])),
    modoCores: params.get("modoCores") ?? undefined,
    preferencias: params.has("preferencias") ? (params.get("preferencias") ?? "").split(",").filter(Boolean) : undefined,
    correspondenciaMinima: numero(params.get("correspondenciaMinima"), 1),
    consulta: params.get("q") ?? undefined,
    codigo: params.get("codigo") ?? undefined,
    variante: params.get("variante") ?? undefined,
    tema: params.get("tema") ?? undefined,
    cores: params.getAll("cor"),
    palavraChave: params.get("palavraChave") ?? undefined,
    elementoVisual: params.get("elementoVisual") ?? undefined,
    categoria: params.get("categoria") ?? undefined,
    ocasiao: params.get("ocasiao") ?? undefined,
    publicoSugerido: params.get("publicoSugerido") ?? undefined,
    contextoUso: params.get("contextoUso") ?? undefined,
    afinidadeVisual: params.get("afinidadeVisual") ?? undefined,
    padraoTextil: params.get("padraoTextil") ?? undefined,
    tipoImagem: params.get("tipoImagem") ?? undefined,
    suporteAplicacao: params.get("suporteAplicacao") ?? undefined,
    conteudoImagem: params.get("conteudoImagem") ?? undefined,
    status: params.get("status") ?? undefined,
    ordenacao: params.get("ordenacao") ?? undefined,
    pagina: numero(params.get("pagina"), 1),
    porPagina: numero(params.get("porPagina"), 24),
  };
}

function numero(valor: string | null, fallback: number) {
  if (valor === null) return fallback;
  const resultado = Number(valor);
  if (!Number.isInteger(resultado)) throw new Error("Parâmetro numérico inválido.");
  return resultado;
}
