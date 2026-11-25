import { z } from "zod";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((valor) => {
  const parsed = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === valor;
});
export const edicaoDadosProducaoSchema = z.object({
  dataEntrega: data,
  prioridadeProducao: z.boolean(),
  anterior: z.object({ dataEntrega: data, prioridadeProducao: z.boolean() }).strict(),
}).strict();
