import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { serializarMovimentacoesEstoque } from "@/lib/estoque-movimentacoes";

const parametros = z.object({
  produtoId: z.uuid(),
  pagina: z.string().regex(/^[1-9]\d*$/).default("1").transform(Number).pipe(z.number().int().min(1).max(1_000_000)),
});
const LIMITE = 50;

export async function GET(request: Request) {
  let usuario;
  try { usuario = await getUsuarioAutenticado(request); }
  catch { return NextResponse.json({ error: "Não autenticado." }, { status: 401 }); }
  try {
    const permissao = await prisma.usuario.findUnique({ where: { id: usuario.id },
      select: { podeVisualizarEstoque: true, podeEditarEstoque: true } });
    if (!usuario.aplicativoId || !permissao || (!permissao.podeVisualizarEstoque && !permissao.podeEditarEstoque)) {
      return NextResponse.json({ error: "Sem permissão para visualizar estoque." }, { status: 403 });
    }
    const entrada = parametros.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!entrada.success) return NextResponse.json({ error: "Produto ou página inválidos." }, { status: 400 });
    const { produtoId, pagina } = entrada.data;
    const aplicativoId = usuario.aplicativoId;
    const resultado = await prisma.$transaction(async tx => {
      const produto = await tx.produto.findFirst({ where: { id: produtoId, aplicativoId }, select: { id: true } });
      if (!produto) return null;
      const where = { produtoId, aplicativoId };
      const total = await tx.movimentacaoEstoque.count({ where });
      const movimentos = await tx.movimentacaoEstoque.findMany({ where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITE, skip: (pagina - 1) * LIMITE,
        select: { id: true, produtoId: true, sku: true, tipoMovimento: true, quantidade: true,
          origem: true, observacao: true, createdAt: true, referenciaId: true },
      });
      return { itens: await serializarMovimentacoesEstoque(movimentos, aplicativoId, tx),
        pagina, total, totalPaginas: Math.max(1, Math.ceil(total / LIMITE)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!resultado) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Erro ao carregar movimentações." }, { status: 500 });
  }
}
