import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { resolverVendedorConsultaOlist } from "@/lib/olist-escopo-vendedor";
import { destinoFornecedorWhere } from "@/lib/fila-fornecedor-destino";
import { z } from "zod";

export async function autorizarPedidoManual(request: Request) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroFilaOlist("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: {
    id: true, ativo: true, aplicativoId: true, podeCriarOlistPedido: true, vinculosOlistVersao: true,
    podeGerenciarFilaPedidos: true,
  } });
  if (!usuario?.ativo || !usuario.podeCriarOlistPedido) throw new ErroFilaOlist("Sem permissão para criar pedidos.", 403);
  return usuario;
}
export async function resolverContaPedidoManual(usuario: { id: string; aplicativoId: string }, destino: string) {
  if (!z.guid().safeParse(destino).success) throw new ErroFilaOlist("Aplicativo inválido.");
  // Criar pedido autoriza o fluxo direcionado nos filhos diretos do pai.
  // A permissão de selecionar filial pertence ao fluxo de fornecedores.
  const conta = await prisma.aplicativo.findFirst({ where: destinoFornecedorWhere(usuario.aplicativoId, destino), select: { id: true, nome: true } });
  if (!conta) throw new ErroFilaOlist("Aplicativo não autorizado.", 403);
  const vendedorId = await resolverVendedorConsultaOlist(usuario, destino);
  return { conta, vendedorId };
}
