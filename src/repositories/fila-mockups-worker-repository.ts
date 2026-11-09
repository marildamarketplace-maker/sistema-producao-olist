import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SaidaMockup = {
  status: "COMPLETED" | "FAILED";
  bucket?: string;
  path?: string;
  width?: number;
  height?: number;
  bytes?: number;
  threadId?: string;
  erro?: string;
};

export type ReservaMockup = {
  id: string;
  aplicativoId: string;
  solicitadoPor: string;
  reservaId: string;
  observacao: string;
  trabalhos: Prisma.JsonArray;
  resultados: Prisma.JsonArray;
  proximaSaida: number;
  tentativas: number;
};

export async function reservarSaidaMockup(aplicativoId: string) {
  const reservaId = randomUUID();
  const [reserva] = await prisma.$queryRaw<ReservaMockup[]>`
    WITH candidato AS (
      SELECT aplicativo_id, solicitado_por, id
      FROM public.fila_mockups
      WHERE aplicativo_id = ${aplicativoId}::uuid
        AND proxima_saida < jsonb_array_length(trabalhos)
        AND ((status = 'PENDING' AND proxima_tentativa_em <= now())
          OR (status = 'PROCESSING' AND reserva_ate <= now()))
      ORDER BY created_at, id, solicitado_por
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.fila_mockups f
    SET status = 'PROCESSING', reserva_id = ${reservaId}::uuid,
        reserva_ate = now() + interval '30 minutes', tentativas = f.tentativas + 1
    FROM candidato c
    WHERE (f.aplicativo_id, f.solicitado_por, f.id) = (c.aplicativo_id, c.solicitado_por, c.id)
    RETURNING f.id, f.aplicativo_id AS "aplicativoId", f.solicitado_por AS "solicitadoPor",
      f.reserva_id AS "reservaId", f.trabalhos, f.resultados, f.observacao,
      f.proxima_saida AS "proximaSaida", f.tentativas
  `;
  return reserva ?? null;
}

function reservaAtiva(reserva: ReservaMockup) {
  return {
    id: reserva.id, aplicativoId: reserva.aplicativoId, solicitadoPor: reserva.solicitadoPor,
    reservaId: reserva.reservaId, proximaSaida: reserva.proximaSaida, status: "PROCESSING",
  };
}

export async function registrarSaidaMockup(reserva: ReservaMockup, saida: SaidaMockup) {
  const resultados = [...reserva.resultados, saida];
  const proximaSaida = reserva.proximaSaida + 1;
  const final = proximaSaida === reserva.trabalhos.length;
  const falhou = resultados.some((item) =>
    item && typeof item === "object" && !Array.isArray(item) && item.status === "FAILED",
  );
  const agora = new Date();
  const { count } = await prisma.filaMockup.updateMany({
    where: reservaAtiva(reserva),
    data: {
      resultados, proximaSaida, status: final ? (falhou ? "FAILED" : "COMPLETED") : "PENDING",
      finalizadoEm: final ? agora : null, tentativas: 0, proximaTentativaEm: agora,
      reservaId: null, reservaAte: null,
    },
  });
  return count === 1;
}

export async function reagendarSaidaMockup(reserva: ReservaMockup, atrasoMs: number, desfazerTentativa: boolean) {
  const { count } = await prisma.filaMockup.updateMany({
    where: reservaAtiva(reserva),
    data: {
      status: "PENDING", proximaTentativaEm: new Date(Date.now() + atrasoMs), reservaId: null, reservaAte: null,
      tentativas: desfazerTentativa ? { decrement: 1 } : undefined,
    },
  });
  return count === 1;
}
