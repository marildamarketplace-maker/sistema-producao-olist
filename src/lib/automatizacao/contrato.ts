import { z } from "zod";

export const horariosSchema = z.array(z.object({
  dia: z.number().int().min(0).max(6),
  hora: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
})).min(1).max(56).refine(
  (horarios) => new Set(horarios.map(({ dia, hora }) => `${dia}:${hora}`)).size === horarios.length,
  "Remova os horários duplicados.",
);

export const habilidadeSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  markdown: z.string().min(1).max(32_000).refine((texto) => texto.trim().length > 0 && !texto.includes("\0")),
});

export const rotinaSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  habilidadeId: z.uuid(),
  horarios: horariosSchema,
  ativa: z.boolean().default(false),
});

export const statusExecucao = ["PENDENTE", "EM_EXECUCAO", "AGUARDANDO_RETRY", "CONCLUIDA", "FALHA_FINAL", "BLOQUEADA"] as const;
