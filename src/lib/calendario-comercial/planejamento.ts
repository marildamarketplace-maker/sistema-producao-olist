import type { PotencialCompra } from "./potencial-compra";

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
  potencialCompra: PotencialCompra;
  id: string; nome: string; regioes: Regiao[]; local?: string; categoria: Categoria;
  produtos: Produto[]; estampas: string; recomendacao: string; data: RegraData;
  divulgacao: "anterior" | "periodo" | "ambos";
  fontes: { titulo: string; url: string }[];
  confirmarProgramacao?: boolean;
  destaques?: { regiao: Regiao; texto: string }[];
};
export const ETAPAS = ["cadastrar", "divulgar", "acontecendo"] as const;
export type Etapa = typeof ETAPAS[number];
export type Filtros = { visao: "mensal" | "anual"; regioes: Regiao[]; produto: Produto | ""; categoria: Categoria | ""; busca: string; mes: number; etapa: Etapa };
export type Ocorrencia = { evento: Evento; meses: number[]; periodo: string; variavel: boolean; referencia: boolean };
export type MesPlanejamento = { mes: number; cadastrar: Ocorrencia[]; divulgar: Ocorrencia[]; acontecendo: Ocorrencia[] };

function intervalo(inicio: number, fim: number): number[] {
  const meses = [inicio];
  while (meses[meses.length - 1] !== fim) meses.push(meses[meses.length - 1] % 12 + 1);
  return meses;
}
/** Janelas anuais de referência: nunca atribuir dia fixo a uma celebração móvel. */
export function resolverOcorrencia(evento: Evento): Ocorrencia {
  const r = evento.data;
  let meses: number[], periodo: string;
  const variavel = r.tipo === "pascoa" || r.tipo === "domingo" || r.tipo === "advento";
  if (r.tipo === "fixa") {
    meses = [r.mes];
    periodo = `${String(r.dia).padStart(2, "0")}/${String(r.mes).padStart(2, "0")}`;
  } else if (r.tipo === "domingo") {
    meses = [r.mes];
    periodo = `${r.ordinal}º domingo de ${MESES[r.mes - 1].toLocaleLowerCase("pt-BR")}`;
  } else if (r.tipo === "advento") {
    meses = [11, 12]; periodo = "Novembro a dezembro · período variável";
  } else if (r.tipo === "pascoa") {
    // A Páscoa pode cair de 22/03 a 25/04. O ano-base serve apenas à
    // aritmética de meses, sem atribuir uma data anual ao evento exibido.
    const inicioMinimo = new Date(Date.UTC(2001, 2, 22 + r.deslocamento));
    const fimMaximo = new Date(Date.UTC(2001, 3, 25 + (r.fimDeslocamento ?? r.deslocamento)));
    meses = intervalo(inicioMinimo.getUTCMonth() + 1, fimMaximo.getUTCMonth() + 1);
    periodo = `${MESES[meses[0] - 1]} a ${MESES[meses[meses.length - 1] - 1]} · data móvel`;
  } else {
    meses = intervalo(r.mes, r.fimMes ?? r.mes);
    periodo = meses.length === 12 ? "Ao longo do ano · confirmar agenda local" : meses.length === 1 ? MESES[r.mes - 1] : `${MESES[r.mes - 1]} a ${MESES[meses[meses.length - 1] - 1]}`;
  }
  return { evento, meses, periodo, variavel, referencia: r.tipo === "referencia" || Boolean(evento.confirmarProgramacao) };
}
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
export function filtrarEventos(eventos: Evento[], filtros: Filtros) {
  return eventos.filter((evento) =>
    evento.regioes.some((r) => r === "Nacional" || filtros.regioes.includes(r)) &&
    (!filtros.produto || evento.produtos.includes(filtros.produto)) &&
    (!filtros.categoria || evento.categoria === filtros.categoria) &&
    (!filtros.busca.trim() || normalizar(`${evento.nome} ${evento.local ?? ""}`).includes(normalizar(filtros.busca.trim()))));
}
export function montarPlanejamento(eventos: Evento[], filtros: Filtros): MesPlanejamento[] {
  const ocorrencias = [...new Map(filtrarEventos(eventos, filtros).map((e) => [e.id, e])).values()]
    .map((e) => resolverOcorrencia(e)).sort((a, b) => a.evento.nome.localeCompare(b.evento.nome, "pt-BR"));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const anterior = (o: Ocorrencia) => o.meses.length < 12 && (o.meses[0] + 10) % 12 + 1 === mes;
    return { mes,
      cadastrar: ocorrencias.filter(anterior),
      divulgar: ocorrencias.filter((o) => (o.evento.divulgacao !== "periodo" && anterior(o)) || (o.evento.divulgacao !== "anterior" && o.meses.includes(mes))),
      acontecendo: ocorrencias.filter((o) => o.meses.includes(mes)),
    };
  });
}
export function mesAtualBrasil(agora = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(agora));
}
export function lerFiltros(params: URLSearchParams, mesAtual: number): Filtros {
  const mes = Number(params.get("mes"));
  return {
    visao: params.get("visao") === "anual" ? "anual" : "mensal",
    regioes: ["Nacional", ...REGIOES.filter((r) => r !== "Nacional" && params.getAll("regiao").includes(r))],
    produto: PRODUTOS.find((p) => p === params.get("produto")) ?? "",
    categoria: CATEGORIAS.find((c) => c === params.get("categoria")) ?? "",
    busca: (params.get("busca") ?? "").slice(0, 120),
    mes: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : mesAtual,
    etapa: ETAPAS.find((e) => e === params.get("etapa")) ?? "acontecendo",
  };
}
export function escreverFiltros(filtros: Filtros): string {
  const params = new URLSearchParams({ mes: String(filtros.mes), etapa: filtros.etapa });
  if (filtros.visao === "anual") params.set("visao", "anual");
  REGIOES.filter((r) => r !== "Nacional" && filtros.regioes.includes(r)).forEach((r) => params.append("regiao", r));
  if (filtros.produto) params.set("produto", filtros.produto);
  if (filtros.categoria) params.set("categoria", filtros.categoria);
  if (filtros.busca) params.set("busca", filtros.busca);
  return params.toString();
}
