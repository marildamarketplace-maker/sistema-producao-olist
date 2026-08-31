import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import {
  buscarEstampaPorCodigoParaPedidos,
  buscarEstampaPorCodigoVarianteParaPedidos,
  obterEstampaComPreviewParaPedidos,
  pesquisarEstampasParaPedidos,
} from "@/services/consultarEstampasPedidosService";

export async function GET(request: NextRequest) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: {
        podeCriarOlistPedido: true,
        podeSolicitarProducao: true,
        podeVisualizarProducao: true,
      },
    });
    if (!usuario || !(
      usuario.podeCriarOlistPedido ||
      usuario.podeSolicitarProducao ||
      usuario.podeVisualizarProducao
    )) {
      return NextResponse.json(
        { error: "Sem permissão para consultar estampas para pedidos." },
        { status: 403 },
      );
    }
    const id = request.nextUrl.searchParams.get("id")?.trim();
    const codigo = request.nextUrl.searchParams.get("codigo")?.trim();
    const variante = request.nextUrl.searchParams.get("variante")?.trim();
    const consulta = request.nextUrl.searchParams.get("q")?.trim();

    if (id) {
      const estampa = await obterEstampaComPreviewParaPedidos(id);
      return estampa
        ? NextResponse.json({ estampa })
        : NextResponse.json({ error: "Estampa não encontrada." }, { status: 404 });
    }
    if (codigo && variante) {
      const estampa = await buscarEstampaPorCodigoVarianteParaPedidos(codigo, variante);
      return estampa
        ? NextResponse.json({ estampa })
        : NextResponse.json({ error: "Estampa não encontrada." }, { status: 404 });
    }
    if (codigo) {
      return NextResponse.json({ estampas: await buscarEstampaPorCodigoParaPedidos(codigo) });
    }
    if (consulta) {
      const limite = numeroConsulta(request, "limite", 50, 1, 100);
      const offset = numeroConsulta(request, "offset", 0, 0, 1_000_000);
      return NextResponse.json({
        estampas: await pesquisarEstampasParaPedidos(consulta, { limite, offset }),
      });
    }

    return NextResponse.json(
      { error: "Informe id, codigo ou q para consultar estampas." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar estampas." },
      { status: 400 },
    );
  }
}

function numeroConsulta(
  request: NextRequest,
  campo: string,
  fallback: number,
  minimo: number,
  maximo: number,
) {
  const valor = request.nextUrl.searchParams.get(campo);
  if (valor === null) return fallback;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  }
  return numero;
}
