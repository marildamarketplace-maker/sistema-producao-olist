import { z } from "zod";
import { FalhaSync, type CamposSync, type JsonValue, type ObservacaoRemota } from "./contrato";

export const PENDENCIAS_VENDEDOR_CONTATO = [
  "REFERENCIA_VENDEDOR", "VENDEDOR_CONTATO_NAO_MAPEADO", "VENDEDOR_CONTATO_AMBIGUO",
  "VENDEDOR_CONTATO_INATIVO", "VENDEDOR_CONTATO_INVALIDO", "VENDEDOR_CONTATO_INCOMPLETO",
  "CATALOGO_VENDEDORES_INVALIDO", "CATALOGO_VENDEDORES_INCONSISTENTE",
];
export const MAXIMO_VENDEDORES_CONTATO = 1_000;
export const VALIDADE_CATALOGO_VENDEDORES_MS = 15 * 60_000;
const idSchema = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d{0,15}$/).refine(v => Number.isSafeInteger(Number(v)))]).transform(String);
const vendedorSchema = z.object({ id: idSchema, nome: z.string().trim().min(1).max(200), situacao: z.enum(["A", "B", "I", "E"]) });
export type VendedorContatoSync = z.infer<typeof vendedorSchema>;
export type ReferenciaVendedorContatoSync = { id: string; nome: string | null };
const catalogoSchema = z.object({ contaIdentidade: z.string().min(1), coletadoEm: z.string().datetime(), offset: z.number().int().min(0).max(MAXIMO_VENDEDORES_CONTATO), total: z.number().int().min(0).max(MAXIMO_VENDEDORES_CONTATO), itens: z.array(vendedorSchema).max(MAXIMO_VENDEDORES_CONTATO) });
export type CatalogoVendedoresContatoSync = z.infer<typeof catalogoSchema>;
export const nomeVendedorContatoSync = (nome: string) => nome.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
export const chaveBaseVendedorContato = (app: string) => `vendedorContato:${app}`;
export const ehBaseVendedorContato = (campo: string) => campo.startsWith("vendedorContato:");

export function referenciaVendedorContatoSync(valor: unknown): ReferenciaVendedorContatoSync | null {
  if (valor === null || valor === undefined) return null;
  const parsed = z.object({ id: idSchema, nome: z.string().trim().min(1).max(200).nullable().optional() }).safeParse(valor);
  if (!parsed.success) throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO", "A referência do vendedor do contato é inválida.");
  return { id: parsed.data.id, nome: parsed.data.nome ?? null };
}

export function interpretarVendedorContatoSync(valor: unknown): VendedorContatoSync {
  const bruto = z.object({ id: idSchema, contato: z.object({ nome: z.string() }), situacao: z.string() }).safeParse(valor);
  const parsed = vendedorSchema.safeParse(bruto.success ? { id: bruto.data.id, nome: bruto.data.contato.nome, situacao: bruto.data.situacao } : null);
  if (!parsed.success) throw new FalhaSync("CATALOGO_VENDEDORES_INVALIDO", "O catálogo de vendedores é inválido.");
  return parsed.data;
}

export function lerCatalogoVendedoresContatoSync(valor: unknown, conta: string): CatalogoVendedoresContatoSync | null {
  const parsed = catalogoSchema.safeParse(valor);
  if (!parsed.success || parsed.data.contaIdentidade !== conta || parsed.data.offset !== parsed.data.itens.length || parsed.data.offset > parsed.data.total || new Set(parsed.data.itens.map(v => v.id)).size !== parsed.data.itens.length) return null;
  return parsed.data;
}

export function idVendedorPorNomeSync(nome: JsonValue, catalogo?: readonly VendedorContatoSync[]): string {
  if (typeof nome !== "string" || !nomeVendedorContatoSync(nome) || nome.length > 200) throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO", "O nome do vendedor precisa ser válido.");
  const parsed = z.array(vendedorSchema).max(MAXIMO_VENDEDORES_CONTATO).safeParse(catalogo);
  if (!parsed.success || new Set(parsed.data.map(v => v.id)).size !== parsed.data.length) throw new FalhaSync("CATALOGO_VENDEDORES_INVALIDO", "Conclua a coleta dos vendedores da conta.");
  const encontrados = parsed.data.filter(v => nomeVendedorContatoSync(v.nome) === nomeVendedorContatoSync(nome));
  if (encontrados.length !== 1) throw new FalhaSync(encontrados.length ? "VENDEDOR_CONTATO_AMBIGUO" : "VENDEDOR_CONTATO_NAO_MAPEADO", "Não existe um vendedor único com esse nome no destino.");
  if (!["A", "B"].includes(encontrados[0].situacao)) throw new FalhaSync("VENDEDOR_CONTATO_INATIVO", "O vendedor do destino não está ativo.");
  return encontrados[0].id;
}

export function resolverVendedorContatoSync(obs: ObservacaoRemota, catalogo: readonly VendedorContatoSync[]): ObservacaoRemota {
  const ref = obs.vendedorContatoRemoto;
  if (ref === undefined) return obs;
  if (!ref) return { ...obs, campos: { ...obs.campos, vendedorNome: null } };
  const encontrado = catalogo.find(v => v.id === ref.id);
  let codigo: string | null = null;
  try {
    if (!encontrado || ref.nome !== null && nomeVendedorContatoSync(ref.nome) !== nomeVendedorContatoSync(encontrado.nome)) codigo = "VENDEDOR_CONTATO_NAO_MAPEADO";
    else idVendedorPorNomeSync(encontrado.nome, catalogo);
  } catch (erro) { if (!(erro instanceof FalhaSync)) throw erro; codigo = erro.codigo; }
  return { ...obs, campos: { ...obs.campos, vendedorNome: encontrado ? nomeVendedorContatoSync(encontrado.nome) : ref.nome === null ? null : nomeVendedorContatoSync(ref.nome) },
    pendencias: [...obs.pendencias.filter(p => p !== "REFERENCIA_VENDEDOR"), ...(codigo ? [codigo] : [])] };
}

/** Traduz só na fronteira HTTP; um ID de origem nunca é aceito como payload. */
export function payloadVendedorContatoSync(payload: CamposSync, id: string | null | undefined): CamposSync {
  const { vendedorNome, ...remoto } = payload;
  void vendedorNome;
  if (id === undefined) throw new FalhaSync("VENDEDOR_CONTATO_NAO_MAPEADO", "Revalide o vendedor do destino antes de atualizar.");
  if (id === null) return remoto;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new FalhaSync("VENDEDOR_CONTATO_INVALIDO", "O identificador do vendedor é inválido.");
  return { ...remoto, vendedor: { id: Number(parsed.data) } };
}
