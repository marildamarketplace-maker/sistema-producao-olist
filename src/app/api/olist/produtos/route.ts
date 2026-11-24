import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { listarProdutosOlistApi } from "@/lib/olist";

const SITUACOES = new Set(["A", "I", "E"]);

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacaoParam = params.get("situacao")?.toUpperCase() ?? "";
  const situacao = SITUACOES.has(situacaoParam)
    ? (situacaoParam as "A" | "I" | "E")
    : undefined;

  try {
    const usuario = await autorizarOlist(request, "podeVisualizarOlistProdutos");
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const resultado = await listarProdutosOlistApi(aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      gtin: params.get("gtin")?.trim() || undefined,
      situacao,
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Erro ao listar produtos Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
