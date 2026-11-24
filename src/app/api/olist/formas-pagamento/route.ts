import { ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";
import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { listarFormasPagamentoOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacao = 1 as const;

  try {
    const usuario = await getUsuarioAutenticado(request);
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    if (!usuario.podeVisualizarOlistFormasPagamento) {
      return NextResponse.json({ error: "Sem permissão para visualizar formas de pagamento." }, { status: 403 });
    }
    const resultado = await listarFormasPagamentoOlistApi(aplicativoId, {
      nome: params.get("nome")?.trim() || undefined,
      situacao,
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Erro ao listar formas de pagamento Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
