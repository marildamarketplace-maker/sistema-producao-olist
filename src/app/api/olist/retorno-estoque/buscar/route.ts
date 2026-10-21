import { NextResponse } from "next/server";
import { autorizarRetorno, erroRetornoResponse, retornoOlistService } from "@/lib/retorno-estoque-olist-api";
import { buscaRetornoSchema } from "@/lib/retorno-estoque-olist-domain";
import { obterDataAtualizacaoPadrao } from "@/lib/olist-filtro-data";

export async function GET(request: Request) {
  try {
    await autorizarRetorno(request);
    return NextResponse.json({ data_atualizacao: obterDataAtualizacaoPadrao().toISOString().slice(0, 10) });
  } catch (error) { return erroRetornoResponse(error); }
}

export async function POST(request: Request) {
  try {
    const usuario = await autorizarRetorno(request);
    const input = buscaRetornoSchema.parse(await request.json());
    return NextResponse.json(await retornoOlistService.buscar(usuario.aplicativoId, input.data_atualizacao));
  } catch (error) { return erroRetornoResponse(error); }
}
