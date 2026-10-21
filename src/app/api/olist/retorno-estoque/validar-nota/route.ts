import { NextResponse } from "next/server";
import { z } from "zod";
import { autorizarRetorno, erroRetornoResponse, validarNotasRetornoOlist } from "@/lib/retorno-estoque-olist-api";
const schema = z.object({ retorno_id: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    const usuario = await autorizarRetorno(request);
    const { retorno_id } = schema.parse(await request.json());
    return NextResponse.json(await validarNotasRetornoOlist(usuario.aplicativoId, retorno_id));
  } catch (error) { return erroRetornoResponse(error); }
}
