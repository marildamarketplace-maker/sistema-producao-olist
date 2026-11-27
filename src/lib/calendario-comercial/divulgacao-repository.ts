import { prisma } from "@/lib/prisma";
import { montarConsultaDivulgacao, serializarPaginaDivulgacao } from "./divulgacao-consulta";
import type { EventoDivulgacao, OrdemDivulgacao } from "./divulgacao";

export async function listarDivulgacao(aplicativoId: string, eventos: EventoDivulgacao[], pagina: number, ordem: OrdemDivulgacao = "prioridade") {
  const referencia = new Date();
  // Somente leitura, sem worker ou integração externa. Limitar o statement é
  // essencial: LIMIT na resposta não limita a agregação necessária ao ranking.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    const linhas = await tx.$queryRaw<unknown[]>(montarConsultaDivulgacao(aplicativoId, eventos, pagina, referencia, ordem));
    return serializarPaginaDivulgacao(linhas);
  }, { maxWait: 5000, timeout: 8000 });
}
