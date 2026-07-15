import { NextResponse } from "next/server";
import { listarContatosOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const SITUACOES = new Set(["B", "A", "I", "E"]);

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacaoParam = params.get("situacao")?.toUpperCase() ?? "";
  const orderBy = params.get("orderBy") === "asc" ? "asc" : "desc";

  try {
    const usuario = await getUsuarioAutenticado(request);
    const resultado = await listarContatosOlistApi(usuario.aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      situacao: SITUACOES.has(situacaoParam) ? situacaoParam as "B" | "A" | "I" | "E" : undefined,
      idVendedor: params.get("idVendedor")?.trim() || undefined,
      cpfCnpj: params.get("cpfCnpj")?.trim() || undefined,
      celular: params.get("celular")?.trim() || undefined,
      orderBy,
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Erro ao listar contatos Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
