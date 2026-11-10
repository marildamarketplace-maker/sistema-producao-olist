import type { z } from "zod";
import type { horariosSchema } from "./contrato";

const minutoMs = 60_000;
const formatador = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function minutoAtual(data: Date) {
  return new Date(Math.floor(data.getTime() / minutoMs) * minutoMs);
}

export function calcularDisparos(horarios: z.infer<typeof horariosSchema>, cursor: Date, agora: Date) {
  const limite = agora.getTime() - 15 * minutoMs;
  const previstos: Date[] = [];
  for (let instante = Math.max(minutoAtual(cursor).getTime() + minutoMs, limite); instante <= agora.getTime(); instante += minutoMs) {
    const data = new Date(instante);
    const partes = Object.fromEntries(formatador.formatToParts(data).map(({ type, value }) => [type, value]));
    if (horarios.some(({ dia, hora }) => dias[dia] === partes.weekday && hora === `${partes.hour}:${partes.minute}`)) {
      previstos.push(data);
    }
  }
  return {
    atrasoAgregado: cursor.getTime() < limite - minutoMs ? new Date(limite - minutoMs) : null,
    elegivel: previstos.pop() ?? null,
    ignorados: previstos,
  };
}
