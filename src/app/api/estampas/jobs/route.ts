import { StatusJobEstampa } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { consultarEstampaJobsPainel } from "@/services/consultarEstampaJobsPainelService";

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { podeVisualizarEstampas: true, podeEditarEstampas: true },
    });
    if (!usuario || (!usuario.podeVisualizarEstampas && !usuario.podeEditarEstampas)) {
      return NextResponse.json({ error: "Sem permissão para visualizar os jobs." }, { status: 403 });
    }

    const url = new URL(request.url);
    const statusTexto = url.searchParams.get("status")?.trim().toUpperCase();
    const status = statusTexto ? validarStatus(statusTexto) : undefined;
    const limite = validarInteiro(url.searchParams.get("limite"), 50, 1, 100, "limite");
    const offset = validarInteiro(url.searchParams.get("offset"), 0, 0, 1_000_000, "offset");
    return NextResponse.json(await consultarEstampaJobsPainel({ status, limite, offset }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar os jobs." },
      { status: 400 },
    );
  }
}

function validarStatus(valor: string): StatusJobEstampa {
  if (!Object.values(StatusJobEstampa).includes(valor as StatusJobEstampa)) {
    throw new Error("Status inválido.");
  }
  return valor as StatusJobEstampa;
}

function validarInteiro(
  valor: string | null,
  fallback: number,
  minimo: number,
  maximo: number,
  campo: string,
) {
  if (valor === null) return fallback;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  }
  return numero;
}
