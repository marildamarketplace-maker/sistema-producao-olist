import { serializarCanonico } from "./cripto";
import { FalhaSync, type CamposSync, type JsonValue } from "./contrato";

export const VERSAO_PRODUTOS_SYNC = 2;
export const MAXIMO_COMPONENTES_SYNC = 100;

export function nomeProdutoElegivelSync(nome: unknown): boolean {
  return typeof nome === "string" && /(^|[^\p{L}\p{N}_])ref(?=$|[^\p{L}\p{N}_])/iu.test(nome.normalize("NFKC"));
}

type ProducaoSync = { produtos: { sku: string; quantidade: number }[]; etapas: string[] };
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const falhar = (): never => { throw new FalhaSync("PRODUCAO_INVALIDA", "A composição de fabricação precisa de uma nova auditoria."); };

/** Representação entre empresas: somente SKU e quantidade, nunca IDs remotos. */
export function producaoCanonicaSync(valor: unknown): ProducaoSync {
  if (!objeto(valor) || !Array.isArray(valor.produtos) || valor.produtos.length > MAXIMO_COMPONENTES_SYNC ||
    !Array.isArray(valor.etapas) || valor.etapas.length > 100 ||
    !valor.etapas.every(e => typeof e === "string" && e.trim() && e.length <= 1000)) return falhar();
  const produtos = valor.produtos.map(item => {
    if (!objeto(item) || typeof item.sku !== "string" || !item.sku.trim() || item.sku.length > 255 ||
      typeof item.quantidade !== "number" || !Number.isFinite(item.quantidade) || item.quantidade <= 0) return falhar();
    return { sku: item.sku, quantidade: item.quantidade };
  }).sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
  if (new Set(produtos.map(p => p.sku)).size !== produtos.length || !produtos.length && !valor.etapas.length) return falhar();
  return { produtos, etapas: [...valor.etapas] as string[] };
}

export function observarProducaoSync(valor: unknown): ProducaoSync {
  if (!objeto(valor) || !Array.isArray(valor.produtos)) return falhar();
  // A rejeição é atômica: nenhum dado do componente fora do escopo é persistido.
  if (valor.produtos.some(item => !objeto(item) || !objeto(item.produto) || !nomeProdutoElegivelSync(item.produto.descricao)))
    throw new FalhaSync("COMPONENTE_FORA_ESCOPO", "A fabricação contém componente sem Ref no nome ou sem identificação completa.");
  return producaoCanonicaSync({ produtos: valor.produtos.map(item => ({ sku: item.produto.sku, quantidade: item.quantidade })), etapas: valor.etapas ?? [] });
}

export function payloadProducaoSync(valor: unknown, ids: ReadonlyMap<string, string> | undefined): CamposSync {
  const producao = producaoCanonicaSync(valor);
  return { etapas: producao.etapas, produtos: producao.produtos.map(item => {
    const id = ids?.get(item.sku);
    // JSON da Olist exige integer. Nunca arredondar um ID acima de MAX_SAFE_INTEGER.
    if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new FalhaSync("COMPONENTE_NAO_MAPEADO", "Um componente não foi confirmado na empresa de destino.");
    return { produto: { id: Number(id), tipo: "P" }, quantidade: item.quantidade };
  }) };
}

/** Se cadastro e composição mudam juntos, cada escrita tem confirmação própria. */
export function primeiraEscritaProdutoSync(campos: CamposSync, anteriores: CamposSync | undefined): {
  campos: CamposSync; somenteProducao: boolean; producaoPendente?: JsonValue;
} {
  if (campos.tipo !== "F" || !anteriores) return { campos, somenteProducao: false };
  const producao = producaoCanonicaSync(campos.producao);
  const anterior = producaoCanonicaSync(anteriores.producao);
  const iguais = (a: JsonValue | undefined, b: JsonValue | undefined) => a === undefined || b === undefined ? a === b : serializarCanonico(a) === serializarCanonico(b);
  const outrosMudaram = Object.keys(campos).some(k => k !== "producao" && !iguais(campos[k], anteriores[k]));
  if (!outrosMudaram) return { campos, somenteProducao: true };
  return { campos: { ...campos, producao: anterior }, somenteProducao: false,
    ...(!iguais(producao, anterior) ? { producaoPendente: producao } : {}) };
}
