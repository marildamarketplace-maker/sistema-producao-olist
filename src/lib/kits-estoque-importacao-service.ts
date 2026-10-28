import type { PrismaClient } from "@prisma/client";
import { loteKitsSchema, validarLoteKits } from "./importar-kits-estoque";

export async function importarLoteKits(db: PrismaClient, aplicativoId: string, payload: unknown) {
  const parsed = loteKitsSchema.safeParse(payload);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const kits = parsed.data.kits;
  return db.$transaction(async (tx) => {
    // Mesmo bloqueio usado pela edição individual e pela confirmação de baixa.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('baixa-kits-estoque', 0))::text`;
    const skusComponentes = [...new Set(kits.flatMap((kit) => kit.componentes.map((item) => item.sku)))];
    const [produtos, atuais] = await Promise.all([
      tx.produto.findMany({ where: { aplicativoId, ativo: true, sku: { in: skusComponentes } }, select: { sku: true } }),
      tx.componenteKitEstoque.findMany({ where: { aplicativoId }, select: { kitSku: true, sku: true } }),
    ]);
    validarLoteKits(kits, new Set(produtos.map((item) => item.sku)), atuais);
    await tx.componenteKitEstoque.deleteMany({ where: { aplicativoId, kitSku: { in: kits.map((kit) => kit.sku) } } });
    await tx.componenteKitEstoque.createMany({ data: kits.flatMap((kit) => kit.componentes.map((item) => ({ ...item, kitSku: kit.sku, aplicativoId }))) });
    return { kits: kits.length, componentes: kits.reduce((total, kit) => total + kit.componentes.length, 0) };
  }, { maxWait: 10000, timeout: 30000 });
}
