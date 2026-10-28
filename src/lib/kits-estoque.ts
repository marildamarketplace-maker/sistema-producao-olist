import { z } from "zod";

export const composicaoKitSchema = z.object({
  sku: z.string().trim().min(1).max(255),
  componentes: z.array(z.object({
    sku: z.string().trim().min(1).max(255),
    quantidade: z.number().int().positive().max(2147483647),
  }).strict()).max(100),
}).strict().superRefine((kit, ctx) => {
  const skus = new Set<string>();
  for (const componente of kit.componentes) {
    if (componente.sku === kit.sku || skus.has(componente.sku)) {
      ctx.addIssue({ code: "custom", message: "O kit não pode conter a si mesmo nem componentes repetidos." });
    }
    skus.add(componente.sku);
  }
});

export function expandirItemKit<T extends { sku: string; quantidade: number }>(
  item: T, componentes: { sku: string; quantidade: number }[],
): (T & { skuOrigem: string })[] {
  if (!componentes.length && item.sku.trim().toUpperCase().startsWith("KIT")) {
    throw new Error(`Kit ${item.sku} sem associação de componentes. Cadastre a composição em Produtos → Associação de kits antes de confirmar a baixa.`);
  }
  if (!Number.isSafeInteger(item.quantidade) || item.quantidade <= 0) throw new Error(`Quantidade inválida para ${item.sku}.`);
  return (componentes.length ? componentes : [{ sku: item.sku, quantidade: 1 }]).map((componente) => {
    const quantidade = item.quantidade * componente.quantidade;
    if (!Number.isSafeInteger(quantidade) || quantidade > 2147483647 || quantidade <= 0) throw new Error(`Quantidade inválida para ${componente.sku}.`);
    return { ...item, skuOrigem: item.sku, sku: componente.sku, quantidade };
  });
}
