import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { criarTokenPublicoConfirmacaoProducao } from "@/lib/confirmacao-entrega-producao-publica";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";

function resposta(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      return resposta({ error: "Identificador da produção inválido." }, 400);
    }
    let autenticado;
    try { autenticado = await getUsuarioAutenticado(request); } catch {
      return resposta({ error: "Sessão expirada. Entre novamente." }, 401);
    }
    const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { podeConfirmarProducao: true } });
    if (!usuario?.podeConfirmarProducao) return resposta({ error: "Sem permissão para confirmar produção." }, 403);
    const solicitacao = await prisma.solicitacaoProducao.findFirst({
      where: { id, aplicativoId: autenticado.aplicativoId, status: "em_producao" }, select: { id: true },
    });
    if (!solicitacao) return resposta({ error: "Solicitação não encontrada ou já confirmada." }, 404);
    const aplicativo = await prisma.aplicativo.findUnique({ where: { id: autenticado.aplicativoId }, select: { jobs: true } });
    if (!aplicativo || !aplicativoTemJob(aplicativo.jobs, CHAVES_JOB.CONFIRMACAO_ENTREGA_PRODUCAO)) {
      return resposta({ error: "Confirmação pública não habilitada para esta empresa." }, 403);
    }
    const token = criarTokenPublicoConfirmacaoProducao({ aplicativoId: autenticado.aplicativoId, solicitacaoId: id });
    return resposta({ token });
  } catch {
    return resposta({ error: "Não foi possível abrir a confirmação." }, 500);
  }
}
