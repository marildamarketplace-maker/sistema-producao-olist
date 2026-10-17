export const REGIOES = ["Nacional", "Nordeste", "Norte", "Sul", "Sudeste"] as const;
export const PRODUTOS = ["Lenços", "Pareôs", "Forros de mesa", "Painéis"] as const;
export const CATEGORIAS = ["Festas populares", "Religioso", "Conscientização", "Country/rural", "Temporadas/comercial"] as const;
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export type Regiao = typeof REGIOES[number];
export type Produto = typeof PRODUTOS[number];
export type Categoria = typeof CATEGORIAS[number];
export type RegraData =
  | { tipo: "fixa"; mes: number; dia: number }
  | { tipo: "periodo"; mes: number; fimMes: number }
  | { tipo: "referencia"; mes: number; fimMes?: number }
  | { tipo: "pascoa"; deslocamento: number; fimDeslocamento?: number }
  | { tipo: "advento" }
  | { tipo: "domingo"; mes: number; ordinal: number };
export type Evento = {
  id: string; nome: string; regioes: Regiao[]; local?: string; categoria: Categoria;
  produtos: Produto[]; estampas: string; recomendacao: string; data: RegraData;
  divulgacao: "anterior" | "periodo" | "ambos";
  fontes: { titulo: string; url: string }[];
  confirmarProgramacao?: boolean;
  destaques?: { regiao: Regiao; texto: string }[];
};
export type Filtros = { ano: number; regioes: Regiao[]; produto: Produto | ""; categoria: Categoria | ""; busca: string };
export type Ocorrencia = { evento: Evento; inicio: string; fim: string; referencia: boolean };
export type MesPlanejamento = { mes: number; cadastrar: Ocorrencia[]; divulgar: Ocorrencia[]; acontecendo: Ocorrencia[] };

function utc(ano: number, mes: number, dia: number) { return new Date(Date.UTC(ano, mes - 1, dia)); }
function iso(data: Date) { return data.toISOString().slice(0, 10); }
function deslocar(data: Date, dias: number) { return new Date(data.getTime() + dias * 86400000); }
export function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utc(ano, Math.floor(n / 31), n % 31 + 1);
}
export function resolverOcorrencia(evento: Evento, ano: number): Ocorrencia {
  const regra = evento.data;
  let inicio: Date, fim: Date;
  if (regra.tipo === "advento") {
    const natal = utc(ano, 12, 25);
    inicio = deslocar(natal, -(natal.getUTCDay() || 7) - 21);
    fim = utc(ano, 12, 24);
  } else if (regra.tipo === "pascoa") {
    inicio = deslocar(pascoa(ano), regra.deslocamento);
    fim = deslocar(pascoa(ano), regra.fimDeslocamento ?? regra.deslocamento);
  } else if (regra.tipo === "domingo") {
    const primeiro = utc(ano, regra.mes, 1);
    inicio = utc(ano, regra.mes, 1 + (7 - primeiro.getUTCDay()) % 7 + 7 * (regra.ordinal - 1));
    fim = inicio;
  } else if (regra.tipo === "fixa") {
    inicio = utc(ano, regra.mes, regra.dia); fim = inicio;
  } else {
    const fimMes = regra.fimMes ?? regra.mes;
    inicio = utc(ano, regra.mes, 1);
    fim = utc(ano + (fimMes < regra.mes ? 1 : 0), fimMes + 1, 0);
  }
  return { evento, inicio: iso(inicio), fim: iso(fim), referencia: regra.tipo === "referencia" || Boolean(evento.confirmarProgramacao) };
}
const indiceMes = (data: string) => Number(data.slice(0, 4)) * 12 + Number(data.slice(5, 7)) - 1;
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
export function filtrarEventos(eventos: Evento[], filtros: Filtros) {
  return eventos.filter((evento) =>
    evento.regioes.some((r) => r === "Nacional" || filtros.regioes.includes(r)) &&
    (!filtros.produto || evento.produtos.includes(filtros.produto)) &&
    (!filtros.categoria || evento.categoria === filtros.categoria) &&
    (!filtros.busca.trim() || normalizar(`${evento.nome} ${evento.local ?? ""}`).includes(normalizar(filtros.busca.trim()))));
}
export function montarPlanejamento(eventos: Evento[], filtros: Filtros): MesPlanejamento[] {
  const unicos = [...new Map(filtrarEventos(eventos, filtros).map((e) => [e.id, e])).values()];
  const ocorrencias = [filtros.ano - 1, filtros.ano, filtros.ano + 1]
    .flatMap((ano) => unicos.map((e) => resolverOcorrencia(e, ano)))
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.evento.nome.localeCompare(b.evento.nome, "pt-BR"));
  return Array.from({ length: 12 }, (_, mes) => {
    const indice = filtros.ano * 12 + mes;
    const acontecendo = (o: Ocorrencia) => indice >= indiceMes(o.inicio) && indice <= indiceMes(o.fim);
    return { mes: mes + 1,
      cadastrar: ocorrencias.filter((o) => indiceMes(o.inicio) - 1 === indice),
      divulgar: ocorrencias.filter((o) =>
        (o.evento.divulgacao !== "periodo" && indiceMes(o.inicio) - 1 === indice) ||
        (o.evento.divulgacao !== "anterior" && acontecendo(o))),
      acontecendo: ocorrencias.filter(acontecendo),
    };
  });
}
export function hojeBrasil(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: valor("year"), mes: valor("month") };
}
export function lerFiltros(params: URLSearchParams, anoAtual: number): Filtros {
  const ano = Number(params.get("ano"));
  const regioes = REGIOES.filter((r) => r !== "Nacional" && params.getAll("regiao").includes(r));
  const produto = PRODUTOS.find((p) => p === params.get("produto")) ?? "";
  const categoria = CATEGORIAS.find((c) => c === params.get("categoria")) ?? "";
  return { ano: Number.isInteger(ano) && ano >= anoAtual - 1 && ano <= anoAtual + 2 ? ano : anoAtual,
    regioes: ["Nacional", ...regioes], produto, categoria, busca: (params.get("busca") ?? "").slice(0, 120) };
}
export function escreverFiltros(filtros: Filtros): string {
  const params = new URLSearchParams({ ano: String(filtros.ano) });
  REGIOES.filter((r) => r !== "Nacional" && filtros.regioes.includes(r)).forEach((r) => params.append("regiao", r));
  if (filtros.produto) params.set("produto", filtros.produto);
  if (filtros.categoria) params.set("categoria", filtros.categoria);
  if (filtros.busca) params.set("busca", filtros.busca);
  return params.toString();
}
export function formatarPeriodo(o: Ocorrencia): string {
  const formatar = (data: string) => data.split("-").reverse().join("/");
  if (o.evento.data.tipo === "referencia" || o.evento.data.tipo === "periodo") {
    const inicio = indiceMes(o.inicio), fim = indiceMes(o.fim);
    return inicio === fim ? `${MESES[inicio % 12]} de ${o.inicio.slice(0, 4)}`
      : `${MESES[inicio % 12]}/${o.inicio.slice(0, 4)} a ${MESES[fim % 12]}/${o.fim.slice(0, 4)}`;
  }
  return o.inicio === o.fim ? formatar(o.inicio) : `${formatar(o.inicio)} a ${formatar(o.fim)}`;
}
