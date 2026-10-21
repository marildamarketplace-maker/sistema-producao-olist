import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { listarPedidosCanceladosOlist, obterPedidoParaRetornoOlist } from "@/lib/olist";
import { criarServicoRetornoOlist } from "@/lib/retorno-estoque-olist-service";
import { RetornoOlistError } from "@/lib/retorno-estoque-olist-domain";

export const retornoOlistService = criarServicoRetornoOlist(prisma, {
  listarCancelados: listarPedidosCanceladosOlist, obterPedido: obterPedidoParaRetornoOlist,
});

export async function autorizarRetorno(request: Request, escrita = false) {
  let autenticado: Awaited<ReturnType<typeof getUsuarioAutenticado>>;
  try { autenticado = await getUsuarioAutenticado(request); }
  catch { throw new RetornoOlistError("Sessão inválida. Entre novamente.", 401); }
  const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: {
    ativo: true, aplicativoId: true, podeVisualizarDevolucao: true, podeSolicitarDevolucao: true,
  } });
  if (!usuario?.ativo || usuario.aplicativoId !== autenticado.aplicativoId
    || (escrita ? !usuario.podeSolicitarDevolucao : !(usuario.podeVisualizarDevolucao || usuario.podeSolicitarDevolucao))) {
    throw new RetornoOlistError("Sem permissão para esta operação de retorno.", 403);
  }
  return autenticado;
}

export function erroRetornoResponse(error: unknown) {
  if (error instanceof RetornoOlistError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: "Dados inválidos. Verifique a data, os itens e as quantidades inteiras informadas." }, { status: 400 });
  }
  // Não expor mensagens Prisma, SQL, tokens ou payloads da integração.
  console.error("Falha interna no retorno de estoque Olist", { codigo: "RETORNO_OLIST_INTERNO" });
  return NextResponse.json({ error: "Não foi possível concluir a operação. Tente novamente com a mesma confirmação." }, { status: 500 });
}
