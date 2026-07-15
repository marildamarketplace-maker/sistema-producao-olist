import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enviarMensagemZApi } from "@/services/zapiService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verificarAutorizacao(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function formatarData(data: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(data);
}

function obterUrlConfirmacao() {
  const definida = process.env.APP_URL?.trim();
  if (definida) return `${definida.replace(/\/$/, "")}/confirmar-producao`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}/confirmar-producao` : null;
}

export async function GET(request: NextRequest) {
  if (!verificarAutorizacao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const aplicativoId = request.nextUrl.searchParams.get("aplicativoId")?.trim();
    if (!aplicativoId) {
      return NextResponse.json({ error: "aplicativoId é obrigatório para executar o job." }, { status: 400 });
    }
    const solicitacoes = await prisma.solicitacaoProducao.findMany({
      where: { aplicativoId, status: "em_producao" },
      select: { id: true, dataEntrega: true, prioridadeProducao: true },
      orderBy: [{ prioridadeProducao: "desc" }, { dataEntrega: "asc" }],
    });

    if (solicitacoes.length === 0) {
      return NextResponse.json({ ok: true, enviados: 0, motivo: "Nenhuma produção aguardando confirmação." });
    }

    const itens = await prisma.itemSolicitacaoProducao.findMany({
      where: { solicitacaoId: { in: solicitacoes.map((item) => item.id) } },
      select: { solicitacaoId: true, quantidadeSolicitada: true },
    });
    const itensPorSolicitacao = new Map<string, { linhas: number; unidades: number }>();
    for (const item of itens) {
      const atual = itensPorSolicitacao.get(item.solicitacaoId) ?? { linhas: 0, unidades: 0 };
      atual.linhas += 1;
      atual.unidades += item.quantidadeSolicitada;
      itensPorSolicitacao.set(item.solicitacaoId, atual);
    }

    const prioritarias = solicitacoes.filter((item) => item.prioridadeProducao).length;
    const totalUnidades = itens.reduce((total, item) => total + item.quantidadeSolicitada, 0);
    const detalhes = solicitacoes.slice(0, 15).map((solicitacao, indice) => {
      const totais = itensPorSolicitacao.get(solicitacao.id) ?? { linhas: 0, unidades: 0 };
      return `${indice + 1}. ${solicitacao.prioridadeProducao ? "🚨 PRIORIDADE · " : ""}Entrega ${formatarData(solicitacao.dataEntrega)} · ${totais.linhas} itens · ${totais.unidades} un.`;
    });
    const url = obterUrlConfirmacao();
    const mensagem = [
      "⏰ *Cobrança diária — Confirmar Produção*",
      "",
      `Existem *${solicitacoes.length} solicitações* aguardando confirmação${prioritarias ? `, sendo *${prioritarias} prioritárias*` : ""}.`,
      `Total pendente: *${itens.length} itens / ${totalUnidades} unidades*.`,
      "",
      ...detalhes,
      ...(solicitacoes.length > detalhes.length ? ["", `E mais ${solicitacoes.length - detalhes.length} solicitações.`] : []),
      "",
      "Por favor, acesse o sistema e confirme a produção.",
      ...(url ? [url] : []),
    ].join("\n");

    const telefones = (process.env.WHATSAPP_CONFIRMACAO_PRODUCAO_NUMEROS ?? "")
      .split(",")
      .map((telefone) => telefone.replace(/\D/g, ""))
      .filter(Boolean);
    if (telefones.length === 0) throw new Error("Variável WHATSAPP_CONFIRMACAO_PRODUCAO_NUMEROS não configurada.");

    const resultados = [];
    for (const telefone of telefones) {
      const resultado = await enviarMensagemZApi({ telefone, mensagem });
      resultados.push({ telefone: `${telefone.slice(0, 4)}******${telefone.slice(-2)}`, messageId: resultado?.messageId ?? resultado?.id ?? null });
    }

    return NextResponse.json({ ok: true, enviados: resultados.length, solicitacoes: solicitacoes.length, resultados });
  } catch (error) {
    console.error("Erro no job de cobrança de confirmação de produção:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro inesperado." }, { status: 500 });
  }
}
