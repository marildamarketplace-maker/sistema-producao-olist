import {
  buscarEstampaCompletaPorCodigoVarianteParaPedidos,
  buscarEstampaCompletaPorIdParaPedidos,
  listarEstampasCompletasPorCodigoParaPedidos,
  pesquisarEstampasPorRelevancia,
  type EstampaPedidosRow,
} from "@/repositories/catalogo-estampas-repository";

export type EstampaParaPedidos = {
  id: string;
  codigo: string;
  variante: string | null;
  titulo: string | null;
  descricao: string | null;
  previewUrl: string | null;
  cores: string[];
  palavrasChave: string[];
};

export type EstampaPesquisadaParaPedidos = EstampaParaPedidos & {
  relevancia: number;
};

export async function pesquisarEstampasParaPedidos(
  consulta: string,
  options: { limite?: number; offset?: number } = {},
): Promise<EstampaPesquisadaParaPedidos[]> {
  const resultados = await pesquisarEstampasPorRelevancia(consulta, options);
  return resultados.map(({ estampa, relevancia }) => ({
    ...paraEstampaPedidos(estampa),
    relevancia,
  }));
}

export async function listarVariantesEstampaParaPedidos(
  codigo: string,
): Promise<EstampaParaPedidos[]> {
  return (await listarEstampasCompletasPorCodigoParaPedidos(codigo)).map(paraEstampaPedidos);
}

export async function buscarEstampaPorCodigoParaPedidos(codigo: string) {
  return listarVariantesEstampaParaPedidos(codigo);
}

export async function buscarEstampaPorCodigoVarianteParaPedidos(
  codigo: string,
  variante: string,
): Promise<EstampaParaPedidos | null> {
  const estampa = await buscarEstampaCompletaPorCodigoVarianteParaPedidos(codigo, variante);
  return estampa ? paraEstampaPedidos(estampa) : null;
}

export async function obterEstampaComPreviewParaPedidos(
  id: string,
): Promise<EstampaParaPedidos | null> {
  const estampa = await buscarEstampaCompletaPorIdParaPedidos(id);
  return estampa ? paraEstampaPedidos(estampa) : null;
}

export function paraEstampaPedidos(estampa: EstampaPedidosRow): EstampaParaPedidos {
  return {
    id: estampa.id,
    codigo: estampa.codigo,
    variante: estampa.variante,
    titulo: estampa.titulo,
    descricao: estampa.descricao,
    previewUrl: estampa.preview_url,
    cores: estampa.cores ?? [],
    palavrasChave: normalizarLista(estampa.palavras_chave),
  };
}

function normalizarLista(valor: string[] | string | null): string[] {
  if (Array.isArray(valor)) return valor;
  if (!valor?.trim()) return [];
  return valor.split(/[,;\n]+/u).map((item) => item.trim()).filter(Boolean);
}
