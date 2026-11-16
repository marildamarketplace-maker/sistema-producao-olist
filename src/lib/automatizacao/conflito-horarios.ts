export type HorarioRotina = { dia: number; hora: string };
const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const minutosSemana = 7 * 24 * 60;

function minuto({ dia, hora }: HorarioRotina) {
  const [h, m] = hora.split(":").map(Number);
  return dia * 1440 + h * 60 + m;
}

function proximos(a: HorarioRotina, b: HorarioRotina) {
  const distancia = Math.abs(minuto(a) - minuto(b));
  return Math.min(distancia, minutosSemana - distancia) < 15;
}

/** Recebe horários já validados pelo contrato; considera a semana cíclica em São Paulo. */
export function conflitoHorarios(
  horarios: HorarioRotina[],
  rotinas: { nome: string; horarios: HorarioRotina[] }[],
): string | null {
  for (let i = 0; i < horarios.length; i++) {
    const horario = horarios[i];
    const interno = horarios.slice(i + 1).find((outro) => proximos(horario, outro));
    if (interno) {
      return `Mantenha pelo menos 15 minutos entre os horários da própria rotina: ${dias[horario.dia]} ${horario.hora} e ${dias[interno.dia]} ${interno.hora}.`;
    }
    for (const rotina of rotinas) {
      const outro = rotina.horarios.find((item) => proximos(horario, item));
      if (outro) {
        return `Conflito com a rotina “${rotina.nome}” (${dias[outro.dia]} ${outro.hora}). Mantenha pelo menos 15 minutos antes ou depois desse horário, no fuso de São Paulo.`;
      }
    }
  }
  return null;
}
