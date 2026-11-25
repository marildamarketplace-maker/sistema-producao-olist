import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Serializa a relação inteira, inclusive cadastros duplicados ou ainda ausentes. */
export async function bloquearRelacaoFornecedor(tx: Prisma.TransactionClient, clienteId: string, matrizId: string) {
  // PrismaPg não desserializa a coluna PostgreSQL void retornada pela função.
  // O cast afeta apenas o resultado descartado; o lock permanece na transação.
  await tx.$queryRaw`SELECT public.fornecedor_relacao_bloquear(${clienteId}::uuid,${matrizId}::uuid)::text`;
}

export async function bloquearRelacoesFornecedor(tx: Prisma.TransactionClient,
  pares: Array<{ clienteId: string; matrizId: string }>) {
  const unicos = new Map(pares.map((par) => [`${par.clienteId}:${par.matrizId}`, par]));
  for (const [, par] of [...unicos].sort(([a], [b]) => a.localeCompare(b))) {
    await bloquearRelacaoFornecedor(tx, par.clienteId, par.matrizId);
  }
}

/** Identifica fornecimento vigente; não concede acesso a contas ou carteiras. */
export async function resolverRelacaoFornecedor(clienteId: string, contaId: string,
  db: Prisma.TransactionClient = prisma): Promise<{ matrizId: string; fornecedorId: string } | null> {
  const conta = await db.aplicativo.findUnique({ where: { id: contaId }, select: { id: true, aplicativoPaiId: true } });
  if (!conta) return null;
  const matrizId = conta.aplicativoPaiId ?? conta.id;
  const fornecedor = await db.fornecedor.findFirst({
    where: { aplicativoId: clienteId, aplicativoPaiId: matrizId, ativo: true,
      aplicativoPai: { aplicativoPaiId: null } },
    select: { id: true }, orderBy: { id: "asc" },
  });
  return fornecedor ? { matrizId, fornecedorId: fornecedor.id } : null;
}
