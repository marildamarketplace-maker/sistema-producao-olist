import { z } from "zod";

const comum = { usuarioId: z.guid(), aplicativoSolicitanteId: z.guid(), matrizId: z.guid(), aplicativoId: z.guid(), vendedorOlistId: z.number().int().positive() };
export const vendedorOrigemFilaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("VINCULO"), ...comum, revisao: z.number().int().positive() }).strict(),
  z.object({ tipo: z.literal("MANUAL"), ...comum }).strict(),
]);
export type VendedorOrigemFila = z.infer<typeof vendedorOrigemFilaSchema>;
