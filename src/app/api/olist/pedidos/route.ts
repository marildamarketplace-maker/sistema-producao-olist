import { resolverVendedorConsultaOlist } from "@/lib/olist-escopo-vendedor";
import { resolverEmpresaOlist } from "@/lib/olist-empresa";
import { NextResponse } from "next/server";
import { listarPedidosOlistApi } from "@/lib/olist";
import { autorizarOlist, ErroAutorizacaoOlist } from "@/lib/olist-autorizacao";

const SITUACOES = new Set(["8", "0", "3", "4", "1", "7", "5", "6", "2", "9"]);

function inteiroNaoNegativo(valor: string | null, padrao: number) {
  if (valor === null || valor.trim() === "") return padrao;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : padrao;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, inteiroNaoNegativo(params.get("limit"), 50)));
  const offset = inteiroNaoNegativo(params.get("offset"), 0);
  const situacao = params.get("situacao")?.trim();
  const origem = params.get("origemPedido")?.trim();
  try {
    const usuario = await autorizarOlist(request, "podeVisualizarOlistPedidos");
    const aplicativoId = await resolverEmpresaOlist(request, usuario.aplicativoId);
    const vendedorId = await resolverVendedorConsultaOlist(usuario, aplicativoId);
    const resultado = await listarPedidosOlistApi(aplicativoId, {
      idVendedor: vendedorId !== null ? String(vendedorId) : undefined,
      numero: params.get("numero")?.trim() || undefined,
      nomeCliente: params.get("nomeCliente")?.trim() || undefined,
      codigoCliente: params.get("codigoCliente")?.trim() || undefined,
      cpfCnpj: params.get("cpfCnpj")?.trim() || undefined,
      dataInicial: params.get("dataInicial")?.trim() || undefined,
      dataFinal: params.get("dataFinal")?.trim() || undefined,
      dataAtualizacao: params.get("dataAtualizacao")?.trim() || undefined,
      situacao: situacao && SITUACOES.has(situacao) ? situacao : undefined,
      numeroPedidoEcommerce: params.get("numeroPedidoEcommerce")?.trim() || undefined,
      origemPedido: origem === "0" || origem === "1" ? origem : undefined,
      orderBy: params.get("orderBy") === "asc" ? "asc" : "desc",
      limit,
      offset,
    });
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ErroAutorizacaoOlist) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: "Não foi possível consultar os pedidos na Olist." },
      { status: 500 },
    );
  }
}
