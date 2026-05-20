import { NextResponse } from "next/server";
import { importarProdutosOlist } from "@/lib/olist";

export async function POST() {
  try {
    const result = await importarProdutosOlist();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Erro ao importar produtos Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado" },
      { status: 500 },
    );
  }
}
