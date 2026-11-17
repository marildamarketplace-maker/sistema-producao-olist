import type { HorarioRotina } from "./contrato";
export type { HorarioRotina } from "./contrato";
const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const minutosSemana = 7 * 24 * 60;

function minuto({ hora }: HorarioRotina) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function distanciaCiclica(a: number, b: number, ciclo: number) {
  const distancia = Math.abs(a - b);
  return Math.min(distancia, ciclo - distancia);
}

function proximos(a: HorarioRotina, b: HorarioRotina) {
  if ("dia" in a && "dia" in b) {
    return distanciaCiclica(a.dia * 1440 + minuto(a), b.dia * 1440 + minuto(b), minutosSemana) < 15;
  }
  if ("diaMes" in a && "diaMes" in b) {
    // Meses com 28–31 dias: inclui proximidade entre o último dia e o dia 1.
    return [28, 29, 30, 31].some((duracao) => a.diaMes <= duracao && b.diaMes <= duracao &&
      distanciaCiclica((a.diaMes - 1) * 1440 + minuto(a), (b.diaMes - 1) * 1440 + minuto(b), duracao * 1440) < 15);
  }
  // Um dia do mês pode cair em qualquer dia da semana ao longo das recorrências.
  return distanciaCiclica(minuto(a), minuto(b), 1440) < 15;
}

function descrever(horario: HorarioRotina) {
  return `${"dia" in horario ? dias[horario.dia] : `Dia ${horario.diaMes} de cada mês`} ${horario.hora}`;
}

/** Recebe horários validados; protege todas as recorrências no calendário de São Paulo. */
export function conflitoHorarios(
  horarios: HorarioRotina[],
  rotinas: { nome: string; horarios: HorarioRotina[] }[],
): string | null {
  for (let i = 0; i < horarios.length; i++) {
    const horario = horarios[i];
    const interno = horarios.slice(i + 1).find((outro) => proximos(horario, outro));
    if (interno) {
      return `Mantenha pelo menos 15 minutos entre os horários da própria rotina: ${descrever(horario)} e ${descrever(interno)}.`;
    }
    for (const rotina of rotinas) {
      const outro = rotina.horarios.find((item) => proximos(horario, item));
      if (outro) {
        return `Conflito com a rotina “${rotina.nome}” (${descrever(outro)}). Mantenha pelo menos 15 minutos antes ou depois desse horário, no fuso de São Paulo.`;
      }
    }
  }
  return null;
}
