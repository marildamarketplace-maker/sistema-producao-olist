import { NextResponse } from "next/server";
import { importarProdutosOlist } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

export async function POST(request: Request) {
  try {
    const usuario = await getUsuarioAutenticado(request);
    const result = await importarProdutosOlist(usuario.aplicativoId);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao importar produtos Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
