import { NextResponse } from "next/server";
import { listarPedidosOlistApi } from "@/lib/olist";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const SITUACOES = new Set(["8", "0", "3", "4", "1", "7", "5", "6", "2", "9"]);

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacao = params.get("situacao")?.trim();
  const origem = params.get("origemPedido")?.trim();
  try {
    const usuario = await getUsuarioAutenticado(request);
    const resultado = await listarPedidosOlistApi(usuario.aplicativoId, {
      numero: params.get("numero")?.trim() || undefined,
      nomeCliente: params.get("nomeCliente")?.trim() || undefined,
      codigoCliente: params.get("codigoCliente")?.trim() || undefined,
      cpfCnpj: params.get("cpfCnpj")?.trim() || undefined,
      dataInicial: params.get("dataInicial")?.trim() || undefined,
      dataFinal: params.get("dataFinal")?.trim() || undefined,
      dataAtualizacao: params.get("dataAtualizacao")?.trim() || undefined,
      situacao: situacao && SITUACOES.has(situacao) ? situacao : undefined,
      idVendedor: usuario.vendedorOlistId ? String(usuario.vendedorOlistId) : undefined,
      numeroPedidoEcommerce: params.get("numeroPedidoEcommerce")?.trim() || undefined,
      origemPedido: origem === "0" || origem === "1" ? origem : undefined,
      orderBy: params.get("orderBy") === "asc" ? "asc" : "desc",
      limit,
      offset,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Erro ao listar pedidos Olist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado ao consultar a Olist." },
      { status: 500 },
    );
  }
}
