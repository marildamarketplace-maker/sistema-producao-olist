import { prisma } from "@/lib/prisma";
import { calcularDisparos, minutoAtual } from "./calendario";
import { horariosSchema } from "./contrato";

export async function agendarAutomatizacoes(data = new Date()) {
  const agora = minutoAtual(data);
  let processadas = 0;
  while (processadas < 100 && Date.now() - data.getTime() < 45_000) {
    const processou = await prisma.$transaction(async (tx) => {
      const [chave] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM automatizacao_rotina
        WHERE ativa AND NOT arquivada AND cursor < ${agora}
        ORDER BY cursor, id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!chave) return false;
      const rotina = await tx.rotinaAutomatizacao.findUniqueOrThrow({
        where: { id: chave.id },
        include: { habilidade: { include: { versoes: { orderBy: { numero: "desc" }, take: 1 } } } },
      });
      const { aplicativoId, id: rotinaId } = rotina;
      const horarios = calcularDisparos(horariosSchema.parse(rotina.horarios), rotina.cursor, agora);
      const disparos = horarios.ignorados.map((previstoEm) => ({ previstoEm, motivo: "SUPERADO" }));
      if (horarios.atrasoAgregado) disparos.push({ previstoEm: horarios.atrasoAgregado, motivo: "ATRASO_AGREGADO" });
      if (horarios.elegivel) {
        const previstoEm = horarios.elegivel;
        const bloqueio = await tx.execucaoAutomatizacao.findFirst({
          where: { aplicativoId, rotinaId, tipo: { not: "TESTE_ROTINA" }, status: { not: "CONCLUIDA" } },
          select: { status: true },
        });
        if (!bloqueio) {
          await tx.execucaoAutomatizacao.create({
            data: { aplicativoId, rotinaId, previstoEm, versaoId: rotina.habilidade.versoes[0].id },
          });
        }
        disparos.push({ previstoEm, motivo: bloqueio?.status === "FALHA_FINAL" ? "FALHA_ANTERIOR" : bloqueio ? "SOBREPOSICAO" : "ENFILEIRADO" });
      }
      await tx.disparoAutomatizacao.createMany({
        data: disparos.map((disparo) => ({ ...disparo, aplicativoId, rotinaId })),
        skipDuplicates: true,
      });
      await tx.rotinaAutomatizacao.update({ where: { id: rotinaId }, data: { cursor: agora } });
      return true;
    });
    if (!processou) break;
    processadas++;
  }
  return processadas;
}
