import { z } from "zod";
import { APLICACOES_DESIGN, DENSIDADES_DESIGN, DISTRIBUICOES_DESIGN, LINGUAGENS_DESIGN, ORIENTACOES_DESIGN } from "@/domain/estampa-atributos-design";

const evidencias = z.array(z.string().trim().min(3).max(120)).max(2);
export const estadosAtributoSchema = z.enum(["IDENTIFICADO", "AUSENTE", "INDETERMINADO", "NAO_APLICAVEL"]);
const motivo = z.string().trim().min(3).max(160).nullable();
export const composicaoVisualSchema = z.object({
  distribuicao: z.object({ estado: estadosAtributoSchema, valores: z.array(z.enum(DISTRIBUICOES_DESIGN)).max(4), motivo, evidencias }).strict(),
  orientacao: z.object({ estado: estadosAtributoSchema, valores: z.array(z.enum(ORIENTACOES_DESIGN)).max(1), motivo, evidencias }).strict(),
  densidade: z.object({ estado: estadosAtributoSchema, valores: z.array(z.enum(DENSIDADES_DESIGN)).max(1), motivo, evidencias }).strict(),
}).strict();
export const linguagemVisualSchema = z.object({ estado: estadosAtributoSchema, valores: z.array(z.enum(LINGUAGENS_DESIGN)).max(3), motivo, evidencias }).strict();
export const aplicacoesSugeridasSchema = z.object({ estado: estadosAtributoSchema,
  sugestoes: z.array(z.object({ termo: z.enum(APLICACOES_DESIGN), confianca: z.number().min(0).max(1), evidencias }).strict()).max(4), motivo,
}).strict();

export function validarEstadoAtributo(atributo: { estado: string; valores: readonly string[]; motivo: string | null; evidencias: readonly string[] }, contexto: z.RefinementCtx, caminho: (string | number)[]) {
  const identificado = atributo.estado === "IDENTIFICADO";
  if (identificado ? !atributo.valores.length || !atributo.evidencias.length || atributo.motivo !== null : atributo.valores.length > 0 || atributo.evidencias.length > 0 || !atributo.motivo) {
    contexto.addIssue({ code: "custom", path: caminho, message: "Identificado exige valores, evidências e motivo nulo; outros estados exigem motivo e listas vazias." });
  }
  if (new Set(atributo.valores).size !== atributo.valores.length) contexto.addIssue({ code: "custom", path: caminho, message: "Valores duplicados." });
}
