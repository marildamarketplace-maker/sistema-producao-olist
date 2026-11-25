import { listarEmpresasFornecedorPedidos } from "@/lib/olist-pedidos-empresa";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function GET(request: Request) {
  const usuario = await getUsuarioAutenticado(request).catch(() => null);
  if (!usuario) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
  try {
    const empresas = await prisma.aplicativo.findMany({
      where: { OR: [{ id: usuario.aplicativoId }, { aplicativoPaiId: usuario.aplicativoId }] },
      select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }],
    });
    const filiais = empresas.filter((empresa) => empresa.id !== usuario.aplicativoId);
    const opcoes = filiais.length ? filiais : empresas;
    if (new URL(request.url).searchParams.get("contexto") === "pedidos") {
      const autorizado = await autorizarOlist(request, "podeVisualizarOlistPedidos");
      const externas = await listarEmpresasFornecedorPedidos(autorizado);
      const ids = new Set(opcoes.map(a => a.id));
      opcoes.push(...externas.filter(a => !ids.has(a.id)));
    }
    const aplicativoId = opcoes[0]?.id ?? usuario.aplicativoId;
    return NextResponse.json({ empresas: opcoes, aplicativoId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    if (erro instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: erro.message }, { status: erro.status });
    return NextResponse.json({ error: "Não foi possível consultar as empresas." }, { status: 500 });
  }
}
