import { NextResponse } from "next/server";
import { z } from "zod";
import { autorizarRetorno, erroRetornoResponse, retornoOlistService } from "@/lib/retorno-estoque-olist-api";

export async function GET(request: Request) {
  try {
    const usuario = await autorizarRetorno(request);
    const pagina = z.coerce.number().int().min(1).max(100000).parse(new URL(request.url).searchParams.get("pagina") ?? "1");
    return NextResponse.json(await retornoOlistService.historico(usuario.aplicativoId, pagina));
  } catch (error) { return erroRetornoResponse(error); }
}
