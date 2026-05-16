export type TurnoProducao = {
  hora_inicio: string;
  hora_fim: string;
  inicia_dia_anterior: boolean;
};

export type PeriodoTurno = {
  periodo_inicio: Date;
  periodo_fim: Date;
};

const TZ_SAO_PAULO = "America/Sao_Paulo";

function parseHora(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Hora inválida: ${hora}`);
  }
  return { hora: h, minuto: m };
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return { year, month, day };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);

  const asUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  return (asUtcMillis - date.getTime()) / 60000;
}

function zonedDateToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset * 60000);
}

function addDaysToYmd(year: number, month: number, day: number, deltaDays: number) {
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function calcularPeriodoTurno(dataReferencia: Date | string, turno: TurnoProducao): PeriodoTurno {
  const referenciaDate = typeof dataReferencia === "string" ? new Date(`${dataReferencia}T12:00:00Z`) : dataReferencia;

  if (Number.isNaN(referenciaDate.getTime())) {
    throw new Error("dataReferencia inválida. Use um Date válido ou string no formato YYYY-MM-DD.");
  }

  const { year, month, day } = formatDateInTimeZone(referenciaDate, TZ_SAO_PAULO);
  const inicioHora = parseHora(turno.hora_inicio);
  const fimHora = parseHora(turno.hora_fim);

  const diaInicio = turno.inicia_dia_anterior ? addDaysToYmd(year, month, day, -1) : { year, month, day };

  const periodo_inicio = zonedDateToUtc(
    diaInicio.year,
    diaInicio.month,
    diaInicio.day,
    inicioHora.hora,
    inicioHora.minuto,
    TZ_SAO_PAULO,
  );

  const periodo_fim = zonedDateToUtc(year, month, day, fimHora.hora, fimHora.minuto, TZ_SAO_PAULO);

  return { periodo_inicio, periodo_fim };
}
