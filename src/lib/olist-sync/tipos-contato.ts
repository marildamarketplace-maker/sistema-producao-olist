import { z } from "zod";
import { FalhaSync, type CamposSync, type ObservacaoRemota } from "./contrato";

export const MAXIMO_TIPOS_CONTATO = 1_000;
export const VALIDADE_CATALOGO_TIPOS_MS = 15 * 60_000;
export const VERSAO_OBSERVACAO_CONTATO = 2;
const identificador = z.string().regex(/^[1-9]\d{0,15}$/).refine(id => Number.isSafeInteger(Number(id)));
const tipoSchema = z.object({ id: identificador, nome: z.string().trim().min(1).max(200), perfilContato: z.number().int().min(0).max(255) });
export type TipoContatoSync = z.infer<typeof tipoSchema>;
export type ReferenciaTipoContatoSync = { id: string; descricao: string | null };
const semanticasSchema = z.array(tipoSchema.omit({ id: true })).max(MAXIMO_TIPOS_CONTATO);
const catalogoSchema = z.object({ contaIdentidade: z.string().min(1), coletadoEm: z.string().datetime(),
  offset: z.number().int().min(0).max(MAXIMO_TIPOS_CONTATO), total: z.number().int().min(0).max(MAXIMO_TIPOS_CONTATO),
  itens: z.array(tipoSchema).max(MAXIMO_TIPOS_CONTATO) });
export type CatalogoTiposContatoSync = z.infer<typeof catalogoSchema>;

export const nomeTipoContatoSync = (nome: string) => nome.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const chaveTipo = (tipo: { nome: string; perfilContato: number }) => JSON.stringify([nomeTipoContatoSync(tipo.nome), tipo.perfilContato]);

export function tiposSemanticosContatoSync(valor: unknown): Array<{ nome: string; perfilContato: number }> {
  const parsed = semanticasSchema.safeParse(valor);
  if (!parsed.success) throw new FalhaSync("TIPOS_CONTATO_INVALIDOS", "Os tipos do contato precisam de nomes e perfis válidos.");
  const tipos = parsed.data.map(tipo => ({ nome: nomeTipoContatoSync(tipo.nome), perfilContato: tipo.perfilContato }));
  if (new Set(tipos.map(chaveTipo)).size !== tipos.length) throw new FalhaSync("TIPOS_CONTATO_AMBIGUOS", "Os tipos do contato possuem equivalências repetidas.");
  return tipos.sort((a, b) => chaveTipo(a).localeCompare(chaveTipo(b)));
}

export function referenciasTiposContatoSync(valor: unknown): ReferenciaTipoContatoSync[] {
  if (valor === null || valor === undefined) return [];
  const parsed = z.array(z.object({ id: z.union([identificador, z.number().int().positive().safe()]).transform(String),
    descricao: z.string().trim().min(1).max(200).nullable().optional() })).max(MAXIMO_TIPOS_CONTATO).safeParse(valor);
  if (!parsed.success) throw new FalhaSync("TIPOS_CONTATO_INVALIDOS", "A referência do tipo de contato é inválida.");
  if (new Set(parsed.data.map(tipo => tipo.id)).size !== parsed.data.length) throw new FalhaSync("TIPOS_CONTATO_AMBIGUOS", "O contato possui tipos repetidos.");
  return parsed.data.map(tipo => ({ id: tipo.id, descricao: tipo.descricao ?? null }));
}

export function lerCatalogoTiposContatoSync(valor: unknown, conta: string): CatalogoTiposContatoSync | null {
  const parsed = catalogoSchema.safeParse(valor);
  if (!parsed.success || parsed.data.contaIdentidade !== conta || parsed.data.offset !== parsed.data.itens.length
    || parsed.data.offset > parsed.data.total || new Set(parsed.data.itens.map(tipo => tipo.id)).size !== parsed.data.itens.length) return null;
  return parsed.data;
}

export function interpretarTipoContatoSync(valor: unknown): TipoContatoSync {
  if (!valor || typeof valor !== "object" || !("id" in valor)) throw new FalhaSync("CONTRATO", "O catálogo de tipos de contato é inválido.");
  const parsed = tipoSchema.safeParse({ ...valor, id: String(valor.id) });
  if (!parsed.success) throw new FalhaSync("CONTRATO", "O catálogo de tipos de contato é inválido.");
  return parsed.data;
}

/** IDs só são usados dentro da própria conta; a comparação usa nome e perfil. */
export function resolverTiposContatoSync(obs: ObservacaoRemota, catalogo: readonly TipoContatoSync[]): ObservacaoRemota {
  if (!obs.tiposContatoRemotos) return obs;
  const tipos: Array<{ nome: string; perfilContato: number }> = [];
  for (const referencia of obs.tiposContatoRemotos) {
    const encontrados = catalogo.filter(tipo => tipo.id === referencia.id);
    if (encontrados.length !== 1 || referencia.descricao !== null && nomeTipoContatoSync(referencia.descricao) !== nomeTipoContatoSync(encontrados[0].nome))
      return { ...obs, pendencias: [...new Set([...obs.pendencias, "TIPOS_CONTATO_NAO_MAPEADOS"])] };
    const tipo = encontrados[0];
    if (catalogo.filter(outro => chaveTipo(outro) === chaveTipo(tipo)).length !== 1)
      return { ...obs, pendencias: [...new Set([...obs.pendencias, "TIPOS_CONTATO_AMBIGUOS"])] };
    tipos.push(tipo);
  }
  const { tiposContatoRemotos: referencias, ...observacao } = obs;
  void referencias;
  return { ...observacao, campos: { ...obs.campos, tiposContato: tiposSemanticosContatoSync(tipos) },
    pendencias: obs.pendencias.filter(p => p !== "REFERENCIA_TIPOS_CONTATO") };
}

export function payloadTiposContatoSync(payload: CamposSync, catalogo?: readonly TipoContatoSync[]): CamposSync {
  const { tiposContato, ...remoto } = payload;
  if (tiposContato === undefined) return remoto;
  const tipos = tiposSemanticosContatoSync(tiposContato);
  if (tipos.length && !catalogo) throw new FalhaSync("TIPOS_CONTATO_NAO_MAPEADOS", "O catálogo da conta de destino precisa ser verificado.");
  const validado = z.array(tipoSchema).max(MAXIMO_TIPOS_CONTATO).safeParse(catalogo ?? []);
  if (!validado.success || new Set(validado.data.map(tipo => tipo.id)).size !== validado.data.length)
    throw new FalhaSync("CATALOGO_TIPOS_INCONSISTENTE", "O catálogo de tipos de contato é inválido.");
  return { ...remoto, tipos: tipos.map(tipo => {
    const encontrados = validado.data.filter(outro => chaveTipo(outro) === chaveTipo(tipo));
    if (encontrados.length !== 1) throw new FalhaSync(encontrados.length ? "TIPOS_CONTATO_AMBIGUOS" : "TIPOS_CONTATO_NAO_MAPEADOS", "Não existe uma equivalência única do tipo na conta de destino.");
    return Number(interpretarTipoContatoSync(encontrados[0]).id);
  }) };
}
