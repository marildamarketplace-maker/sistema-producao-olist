export type RegraRecorrencia = {
  periodicidade: "DIARIA" | "SEMANAL" | "QUINZENAL" | "MENSAL";
  dataInicio: Date;
  dataEncerramento: Date | null;
  horaPrevista: string | null;
  diasSemana: number[];
  diaMes: number | null;
  ordinalSemanaMes: number | null;
  diaSemanaMensal: number | null;
};

const DIA_MS = 86_400_000;

function soData(data: Date) {
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

function combinaDataHora(data: Date, hora: string | null) {
  const dia = data.toISOString().slice(0, 10);
  return new Date(`${dia}T${hora ?? "09:00"}:00-03:00`);
}

function correspondeAoMes(data: Date, regra: RegraRecorrencia) {
  if (regra.diaMes) {
    const ultimoDia = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)).getUTCDate();
    return data.getUTCDate() === Math.min(regra.diaMes, ultimoDia);
  }
  if (!regra.ordinalSemanaMes || regra.diaSemanaMensal === null) return false;
  if (data.getUTCDay() !== regra.diaSemanaMensal) return false;
  return Math.floor((data.getUTCDate() - 1) / 7) + 1 === regra.ordinalSemanaMes;
}

export function gerarDatasRecorrencia(regra: RegraRecorrencia, inicioPeriodo: Date, fimPeriodo: Date) {
  const inicioTarefa = soData(regra.dataInicio);
  const fimTarefa = regra.dataEncerramento ? soData(regra.dataEncerramento) : null;
  const inicio = new Date(Math.max(soData(inicioPeriodo).getTime(), inicioTarefa.getTime()));
  const fim = new Date(Math.min(soData(fimPeriodo).getTime(), fimTarefa?.getTime() ?? Number.MAX_SAFE_INTEGER));
  const datas: Date[] = [];
  if (inicio > fim) return datas;

  for (let cursor = inicio; cursor <= fim; cursor = new Date(cursor.getTime() + DIA_MS)) {
    let incluir = false;
    if (regra.periodicidade === "DIARIA") incluir = regra.diasSemana.includes(cursor.getUTCDay());
    if (regra.periodicidade === "SEMANAL") incluir = regra.diasSemana[0] === cursor.getUTCDay();
    if (regra.periodicidade === "QUINZENAL") incluir = Math.floor((cursor.getTime() - inicioTarefa.getTime()) / DIA_MS) % 14 === 0;
    if (regra.periodicidade === "MENSAL") incluir = correspondeAoMes(cursor, regra);
    if (incluir) datas.push(combinaDataHora(cursor, regra.horaPrevista));
  }
  return datas;
}

