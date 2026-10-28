import type { PrismaClient } from "@prisma/client";

export class ClienteKitsDesatualizadoError extends Error {}

export function verificarClienteKits(db: Pick<PrismaClient, "componenteKitEstoque">) {
  if (!db.componenteKitEstoque || typeof db.componenteKitEstoque.findMany !== "function") {
    throw new ClienteKitsDesatualizadoError();
  }
}

export function erroApiKits(error: unknown, mensagem = "Não foi possível carregar as associações de kits. Tente novamente.") {
  if (error instanceof ClienteKitsDesatualizadoError) return { status: 503, error: "O cliente Prisma do servidor está desatualizado. Execute prisma generate e reinicie o servidor." };
  const codigo = error && typeof error === "object" && "code" in error ? error.code : null;
  if (codigo === "P2021" || codigo === "P2022") return {
    status: 503, error: "A estrutura de associação de kits não está atualizada no banco. Aplique a migration de kits antes de utilizar esta tela.",
  };
  return { status: 500, error: mensagem };
}

export async function consultarKits(db: Pick<PrismaClient, "componenteKitEstoque">, aplicativoId: string) {
  verificarClienteKits(db);
  return { componentes: await db.componenteKitEstoque.findMany({ where: { aplicativoId }, orderBy: [{ kitSku: "asc" }, { sku: "asc" }] }) };
}
