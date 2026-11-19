import { z } from "zod";
import { dataCriacaoPedidoSku, hojeSku } from "@/lib/anotar-sku/periodo";

export const CHAVE_PEDIDOS_SEM_ENVIO = "alertar-pedidos-sem-envio";
export const SITUACOES_SEM_ENVIO = [1, 7] as const;
export const LIMITE_PAGINA_SEM_ENVIO = 100;
const DIA_MS = 86_400_000;

export type PedidoSemEnvio = { id: string; numero: string; situacao: number; dataCriacao: string };
export type PaginaSemEnvio = { pedidos: PedidoSemEnvio[]; total: number };
export type ReservaSemEnvio = {
  aplicativoId: string; referencia: Date; situacaoIndice: number; paginaOffset: number;
  reservaId: string; tentativas: number;
};

export class FalhaPedidosSemEnvio extends Error {
  constructor(readonly codigo: string, readonly temporaria = false, readonly retryAfterMs = 0) {
    super(`Falha na consulta de pedidos sem envio (${codigo}).`);
  }
}

/** A regra usa dias corridos do calendário de São Paulo: exatamente cinco não alerta. */
export function periodoSemEnvio(agora = new Date()) {
  const referencia = hojeSku(agora);
  const dataFinal = new Date(Date.parse(referencia) - 6 * DIA_MS).toISOString().slice(0, 10);
  return { referencia, dataFinal };
}

const idSchema = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,30}$/)]).transform(String);
const paginaSchema = z.object({
  itens: z.array(z.object({
    id: idSchema,
    numeroPedido: idSchema.nullish(),
    situacao: z.number().int().min(0).max(10),
    dataCriacao: z.string(),
  })).max(LIMITE_PAGINA_SEM_ENVIO),
  paginacao: z.object({ total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
});

export function interpretarPaginaSemEnvio(payload: unknown): PaginaSemEnvio {
  const resultado = paginaSchema.safeParse(payload);
  if (!resultado.success) throw new FalhaPedidosSemEnvio("CONTRATO");
  const { itens, paginacao } = resultado.data;
  if (paginacao.total < itens.length || new Set(itens.map(p => p.id)).size !== itens.length) {
    throw new FalhaPedidosSemEnvio("CONTRATO");
  }
  const pedidos = itens.map(p => {
    const dataCriacao = dataCriacaoPedidoSku(p.dataCriacao);
    if (!dataCriacao) throw new FalhaPedidosSemEnvio("DATA_CRIACAO_INVALIDA");
    return { id: p.id, numero: p.numeroPedido ?? p.id, situacao: p.situacao, dataCriacao };
  });
  return { pedidos, total: paginacao.total };
}

export function selecionarPedidosSemEnvio(pedidos: PedidoSemEnvio[], referencia: Date) {
  const limite = new Date(referencia.getTime() - 5 * DIA_MS).toISOString().slice(0, 10);
  return pedidos.filter(p => (p.situacao === 1 || p.situacao === 7) && p.dataCriacao < limite);
}

/** Divide em mensagens limitadas, sem omitir pedidos nem incluir dados pessoais. */
export function mensagensPedidosSemEnvio(pedidos: PedidoSemEnvio[], referencia: Date, nome: string) {
  const dia = referencia.toISOString().slice(0, 10);
  const cabecalho = [
    `Pedidos com possível atraso no envio — ${nome.replace(/[\r\n]/g, " ").slice(0, 100)}`,
    `Verificação: ${dia.split("-").reverse().join("/")}`,
    "Criados há mais de 5 dias corridos e ainda em Faturada ou Pronto para envio na Olist.",
    "Confira a expedição e atualize a situação caso já tenham sido enviados.", "",
  ].join("\n");
  const mensagens: string[] = [];
  let atual = cabecalho;
  for (const pedido of pedidos) {
    const dias = Math.round((Date.parse(dia) - Date.parse(pedido.dataCriacao)) / DIA_MS);
    const linha = `Pedido ${pedido.numero} (ID ${pedido.id}) | ${pedido.situacao === 1 ? "Faturada" : "Pronto para envio"} | criado ${pedido.dataCriacao.split("-").reverse().join("/")} | ${dias} dias\n`;
    if ((atual + linha).length > 3_500) { mensagens.push(atual.trimEnd()); atual = cabecalho; }
    atual += linha;
  }
  if (pedidos.length) mensagens.push(atual.trimEnd());
  return mensagens;
}
