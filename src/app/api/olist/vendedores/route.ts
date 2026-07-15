import { NextResponse } from "next/server";
import { listarVendedoresOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  try {
    const usuario = await getUsuarioAutenticado(request);
    const resultado = await listarVendedoresOlistApi(usuario.aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      codigo: params.get("codigo")?.trim() || undefined,
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Erro ao listar vendedores Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
