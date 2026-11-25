import { z } from "zod";
import { UFS_DIRECIONAMENTO } from "./direcionamento-pedidos-contrato";

const idOlist = z.number().int().positive().max(2147483647);
const pessoaReferenciaSchema = z.object({
  id: idOlist,
  nome: z.string().trim().min(1).max(200),
  cpfCnpj: z.string().trim().min(1).max(32).nullable(),
}).strict();

/** Dados mínimos da origem. Sua presença no navegador não comprova identidade. */
export const referenciaPedidoManualSchema = z.object({
  aplicativoId: z.guid(),
  vendedor: pessoaReferenciaSchema,
  cliente: pessoaReferenciaSchema.extend({ uf: z.enum(UFS_DIRECIONAMENTO).nullable() }),
}).strict();

export type ReferenciaPedidoManual = z.infer<typeof referenciaPedidoManualSchema>;

const vinculoManualSchema = z.object({
  aplicativoId: z.guid(), vendedorOlistId: idOlist,
  revisao: z.number().int().positive().max(2147483647),
}).strict();

/** Proveniência derivada no servidor; números iguais não comprovam o mesmo vínculo. */
export const fornecedorManualSchema = z.object({
  fornecedorId: z.guid(), matrizId: z.guid(), aplicativoSolicitanteId: z.guid(), autorId: z.guid(),
  referencia: vinculoManualSchema, destino: vinculoManualSchema,
}).strict();
export type FornecedorPedidoManual = z.infer<typeof fornecedorManualSchema>;
