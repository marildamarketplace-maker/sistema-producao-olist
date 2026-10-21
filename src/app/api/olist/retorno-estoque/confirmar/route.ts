import { NextResponse } from "next/server";
import { autorizarRetorno, erroRetornoResponse, retornoOlistService } from "@/lib/retorno-estoque-olist-api";
import { confirmarRetornoSchema } from "@/lib/retorno-estoque-olist-domain";

export async function POST(request: Request) {
  try {
    const usuario = await autorizarRetorno(request, true);
    const input = confirmarRetornoSchema.parse(await request.json());
    return NextResponse.json(await retornoOlistService.confirmar(usuario.aplicativoId, usuario.id, input));
  } catch (error) { return erroRetornoResponse(error); }
}
