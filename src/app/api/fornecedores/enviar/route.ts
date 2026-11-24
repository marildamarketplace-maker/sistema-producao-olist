import { NextResponse } from "next/server";

/** Mantém abas antigas sem executar o fluxo de envio direto desativado. */
export async function POST() {
  return NextResponse.json({
    error: "O envio direto ao fornecedor foi desativado. Use Enviar para fila do Fornecedor.",
    code: "ENVIO_DIRETO_DESATIVADO",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
