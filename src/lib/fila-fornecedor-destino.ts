import type { Prisma } from "@prisma/client";

/** O destino é a própria conta do fornecedor ou um filho direto, nunca outro grupo/neto. */
export function destinoFornecedorWhere(matrizId: string, destinoId: string) {
  return { id: destinoId, OR: [{ id: matrizId }, { aplicativoPaiId: matrizId }] } satisfies Prisma.AplicativoWhereInput;
}

/** Mantém a relação de destino estável até confirmar a gravação/reserva local. */
export async function bloquearDestinoFornecedor(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">, matrizId: string, destinoId: string,
): Promise<boolean> {
  const destinos = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo
    WHERE id = ${destinoId}::uuid AND (id = ${matrizId}::uuid OR aplicativo_pai_id = ${matrizId}::uuid)
    FOR SHARE`;
  return destinos.length === 1;
}
