import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarTokenPublicoConfirmacaoProducao } from "@/lib/confirmacao-entrega-producao-publica";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { carregarImagemItemProducao } from "@/lib/producao-imagem";
import { DetalheProducaoError } from "@/lib/producao-detalhes-contrato";
import { LimiteRequisicoesOlistError } from "@/lib/olist-errors";

function resposta(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await context.params;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(itemId)) return resposta({ error: "Item inválido." }, 400);
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    let payload;
    try {
      if (!token || token.length > 2048) throw new Error();
      payload = validarTokenPublicoConfirmacaoProducao(token);
    } catch { return resposta({ error: "Link de confirmação inválido ou expirado." }, 401); }
    const aplicativo = await prisma.aplicativo.findUnique({ where: { id: payload.aplicativoId }, select: { jobs: true } });
    if (!aplicativo || !aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO)) return resposta({ error: "Link de confirmação inválido." }, 401);
    const pendente = await prisma.solicitacaoProducao.findFirst({ where: { id: payload.solicitacaoId, aplicativoId: payload.aplicativoId, status: "em_producao" }, select: { id: true } });
    if (!pendente) return resposta({ error: "Solicitação não encontrada ou já confirmada." }, 404);
    const imagemUrl = await carregarImagemItemProducao(payload.aplicativoId, payload.solicitacaoId, itemId);
    return resposta({ imagemUrl });
  } catch (error) {
    if (error instanceof DetalheProducaoError) return resposta({ error: error.message }, error.status);
    if (error instanceof LimiteRequisicoesOlistError) return resposta({ error: "Limite do Olist atingido. Aguarde e tente novamente." }, 429);
    return resposta({ error: "Não foi possível carregar a imagem." }, 500);
  }
}
