import { resolverVendedorConsultaOlist } from "@/lib/olist-escopo-vendedor";
import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { listarContatosOlistApi } from "@/lib/olist";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";

const SITUACOES = new Set(["B", "A", "I", "E"]);

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  if (valor === null || valor.trim() === "") return padrao;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacaoParam = params.get("situacao")?.toUpperCase() ?? "";
  const orderBy = params.get("orderBy") === "asc" ? "asc" : "desc";

  try {
    const usuario = await autorizarOlist(request, "podeVisualizarOlistContatos");
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const vendedorId = await resolverVendedorConsultaOlist(usuario, aplicativoId);
    const resultado = await listarContatosOlistApi(aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      situacao: SITUACOES.has(situacaoParam) ? situacaoParam as "B" | "A" | "I" | "E" : undefined,
      idVendedor: vendedorId !== null ? String(vendedorId) : params.get("idVendedor")?.trim() || undefined,
      cpfCnpj: params.get("cpfCnpj")?.trim() || undefined,
      celular: params.get("celular")?.trim() || undefined,
      orderBy,
      limit,
      offset,
    });
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: "Não foi possível consultar os contatos na Olist." },
      { status: 500 },
    );
  }
}
