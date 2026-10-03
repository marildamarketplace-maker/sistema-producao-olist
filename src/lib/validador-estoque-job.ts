import { NenhumItemElegivelOlistError } from "@/lib/olist-errors";
import type {
  GerarSolicitacaoPorPedidosOlistInput,
  ResultadoGerarSolicitacaoPorPedidosOlist,
} from "@/lib/olist";

const TIME_ZONE = "America/Sao_Paulo";
const LIMITE_MENSAGEM_WHATSAPP = 3_500;

export const SITUACOES_VALIDADOR_ESTOQUE = ["0", "3", "4", "1"] as const;

type ResultadoValidacao = ResultadoGerarSolicitacaoPorPedidosOlist;
type ItemNovaSolicitacao = ResultadoValidacao["itens"][number];
type GerarSolicitacao = (
  input: GerarSolicitacaoPorPedidosOlistInput,
) => Promise<ResultadoValidacao>;

export type ResultadoJobValidadorEstoque =
  | {
      tipo: "VALIDADO";
      dataLimite: string;
      resultado: ResultadoValidacao;
    }
  | {
      tipo: "SEM_ITENS_ELEGIVEIS";
      dataLimite: string;
    };

type ConteudoNotification = {
  titulo: string;
  mensagem: string;
};

function formatarDataSaoPaulo(data: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value]),
  );

  return `${valores.year}-${valores.month}-${valores.day}`;
}

function formatarDataHoraSaoPaulo(data: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(data);
}

function formatarItem(item: ItemNovaSolicitacao) {
  const detalhes = [
    `${item.sku}: ${item.quantidade_solicitada} un. para nova solicitação`,
    `demanda ${Number(item.quantidade_pedidos ?? 0)}`,
    `estoque ${Number(item.estoque_atual ?? 0)}`,
  ];
  const quantidadeEmProducao = Number(item.quantidade_em_producao ?? 0);
  if (quantidadeEmProducao > 0) {
    detalhes.push(`em produção ${quantidadeEmProducao}`);
  }
  if (item.prioridade_producao) detalhes.push("PRIORIDADE");
  return `- ${detalhes.join(" | ")}`;
}

function montarMensagemLimitada(cabecalho: string[], itens: string[]) {
  const linhas = [...cabecalho];
  let itensIncluidos = 0;

  for (const item of itens) {
    const omitidosDepois = itens.length - itensIncluidos - 1;
    const resumoOmitidos = omitidosDepois > 0
      ? `- ... e mais ${omitidosDepois} item(ns).`
      : null;
    const candidato = [...linhas, item, ...(resumoOmitidos ? [resumoOmitidos] : [])]
      .join("\n");

    if (candidato.length > LIMITE_MENSAGEM_WHATSAPP) break;
    linhas.push(item);
    itensIncluidos += 1;
  }

  const quantidadeOmitida = itens.length - itensIncluidos;
  if (quantidadeOmitida > 0) {
    const resumoOmitidos = `- ... e mais ${quantidadeOmitida} item(ns).`;
    linhas.push(resumoOmitidos);
  }

  return linhas.join("\n").slice(0, LIMITE_MENSAGEM_WHATSAPP);
}

export function criarNotificationFaltaEstoque(
  resultado: ResultadoValidacao,
  executadoEm = new Date(),
): ConteudoNotification {
  const totalUnidades = resultado.itens.reduce(
    (total, item) => total + item.quantidade_solicitada,
    0,
  );
  const cabecalho = [
    "O validador de estoque encontrou itens para Nova solicitação.",
    "",
    `Executado em: ${formatarDataHoraSaoPaulo(executadoEm)}`,
    "Situações: 0 - Aberta, 3 - Aprovada, 4 - Preparando Envio e 1 - Faturada",
    `Pedidos encontrados: ${resultado.pedidos_encontrados}`,
    `Itens: ${resultado.itens.length} SKU(s) / ${totalUnidades} unidade(s)`,
    "",
  ];
  return {
    titulo: "Alerta de estoque Olist",
    mensagem: montarMensagemLimitada(
      cabecalho,
      resultado.itens.map(formatarItem),
    ),
  };
}

export function criarNotificationErroValidadorEstoque(input: {
  error: unknown;
  aplicativoId?: string | null;
  ocorridoEm?: Date;
}): ConteudoNotification {
  const detalhe = input.error instanceof Error
    ? input.error.message
    : "Erro inesperado ao executar o job.";

  return {
    titulo: "Erro no validador de estoque Olist",
    mensagem: [
      "O job VALIDADOR_ESTOQUE falhou.",
      "",
      `Data do erro: ${formatarDataHoraSaoPaulo(input.ocorridoEm ?? new Date())}`,
      `Aplicativo: ${input.aplicativoId ?? "não identificado"}`,
      `Detalhe: ${detalhe.slice(0, 1_000)}`,
    ].join("\n"),
  };
}

export async function executarValidadorEstoque(
  input: { aplicativoId: string; executadoEm?: Date },
  gerarSolicitacao: GerarSolicitacao,
): Promise<ResultadoJobValidadorEstoque> {
  const dataLimite = formatarDataSaoPaulo(input.executadoEm ?? new Date());
  try {
    const resultado = await gerarSolicitacao({
      aplicativoId: input.aplicativoId,
      dataLimite,
      filtroDataBase: "APROVACAO_PEDIDO",
      situacoes: [...SITUACOES_VALIDADOR_ESTOQUE],
    });

    return { tipo: "VALIDADO", dataLimite, resultado };
  } catch (error) {
    if (error instanceof NenhumItemElegivelOlistError) {
      return { tipo: "SEM_ITENS_ELEGIVEIS", dataLimite };
    }
    throw error;
  }
}
