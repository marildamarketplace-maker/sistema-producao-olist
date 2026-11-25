import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { resolverVendedorConsultaOlist } from "@/lib/olist-escopo-vendedor";
import { destinoFornecedorWhere } from "@/lib/fila-fornecedor-destino";
import { z } from "zod";
import { resolverRelacaoFornecedor } from "@/lib/fornecedor-relacao";
import { obterVinculoVendedorDoUsuario } from "@/lib/usuario-vendedor-olist";

export type ReferenciaAplicativoManual = { id: string; nome: string; fornecedorId?: string };

export async function listarReferenciasPedidoManual(aplicativoId: string): Promise<ReferenciaAplicativoManual[]> {
  const [internos, fornecedores] = await Promise.all([
    prisma.aplicativo.findMany({ where: { OR: [{ id: aplicativoId }, { aplicativoPaiId: aplicativoId }] },
      select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001 }),
    prisma.fornecedor.findMany({ where: { aplicativoId, ativo: true, aplicativoPai: { aplicativoPaiId: null } },
      select: { id: true, aplicativoPai: { select: { id: true, nome: true } } },
      orderBy: [{ aplicativoPaiId: "asc" }, { id: "asc" }], take: 1001 }),
  ]);
  if (internos.length > 1000 || fornecedores.length > 1000) throw new ErroFilaOlist("Limite de aplicativos excedido.", 409);
  const filhos = internos.filter(a => a.id !== aplicativoId);
  const opcoes: ReferenciaAplicativoManual[] = [...(filhos.length ? filhos : internos)];
  const ids = new Set(opcoes.map(a => a.id));
  for (const fornecedor of fornecedores) if (!ids.has(fornecedor.aplicativoPai.id)) {
    ids.add(fornecedor.aplicativoPai.id);
    opcoes.push({ ...fornecedor.aplicativoPai, fornecedorId: fornecedor.id });
  }
  if (opcoes.length > 1000) throw new ErroFilaOlist("Limite de aplicativos excedido.", 409);
  return opcoes;
}

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
  if (conta) {
    const vendedorId = await resolverVendedorConsultaOlist(usuario, destino);
    return { conta, vendedorId, fornecedor: null };
  }
  const fornecedor = await resolverRelacaoFornecedor(usuario.aplicativoId, destino);
  if (!fornecedor) throw new ErroFilaOlist("Aplicativo não autorizado.", 403);
  const vinculo = await obterVinculoVendedorDoUsuario(usuario.id, destino);
  if (!vinculo || vinculo.origemAplicativoId !== usuario.aplicativoId || vinculo.fornecedorMatrizId !== fornecedor.matrizId) {
    throw new ErroFilaOlist("Aguardando configuração de vendedor pelo fornecedor.", 403);
  }
  const externa = await prisma.aplicativo.findUnique({ where: { id: destino }, select: { id: true, nome: true } });
  if (!externa) throw new ErroFilaOlist("Aplicativo não autorizado.", 403);
  return { conta: { id: externa.id, nome: externa.nome }, vendedorId: vinculo.vendedorOlistId, fornecedor };
}
