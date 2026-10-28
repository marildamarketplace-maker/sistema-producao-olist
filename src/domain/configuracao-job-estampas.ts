import { z } from "zod";

export const configuracaoJobEstampasSchema = z.object({
  pausado: z.boolean(),
  variantesPermitidas: z.array(z.string().trim().min(1).max(100)).max(100)
    .transform(variantes => [...new Set(variantes.map(v => v.toUpperCase()))]),
  termosIgnoradosNomeArquivo: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

export type ConfiguracaoJobEstampas = z.infer<typeof configuracaoJobEstampasSchema>;
