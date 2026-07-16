import { NextResponse } from "next/server";
import { listarFormasRecebimentoOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacaoNumero = Number(params.get("situacao"));
  const situacao = situacaoNumero === 1 || situacaoNumero === 2 ? situacaoNumero : undefined;

  try {
    const usuario = await getUsuarioAutenticado(request);
    if (!usuario.podeVisualizarOlistFormasRecebimento) {
      return NextResponse.json({ error: "Sem permissão para visualizar formas de recebimento." }, { status: 403 });
    }
    const resultado = await listarFormasRecebimentoOlistApi(usuario.aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      situacao,
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Erro ao listar formas de recebimento Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
