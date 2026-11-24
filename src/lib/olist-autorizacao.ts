import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

type PermissaoOlist = "podeVisualizarOlistProdutos" | "podeVisualizarOlistFormasPagamento" | "podeVisualizarOlistFormasRecebimento" | "podeVisualizarOlistPedidos" | "podeCriarOlistPedido" | "podeVisualizarOlistContatos" | "podeVisualizarOlistVendedores";

export class ErroAutorizacaoOlist extends Error {
  constructor(message: string, readonly status: 401 | 403) { super(message); }
}

/** Autoriza a operação na conta própria; um vínculo de vendedor não concede acesso. */
export async function autorizarOlist(request: Request, permissao: PermissaoOlist) {
  const autenticado = await getUsuarioAutenticado(request).catch(() => {
    throw new ErroAutorizacaoOlist("Sessão inválida ou expirada.", 401);
  });
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: {
      id: true, aplicativoId: true, ativo: true,
      podeVisualizarOlistProdutos: true, podeVisualizarOlistFormasPagamento: true, podeVisualizarOlistFormasRecebimento: true,
      podeVisualizarOlistPedidos: true, podeCriarOlistPedido: true,
      podeVisualizarOlistContatos: true, podeVisualizarOlistVendedores: true,
    },
  });
  if (!usuario?.ativo || !usuario[permissao]) {
    throw new ErroAutorizacaoOlist("Sem permissão para esta operação na Olist.", 403);
  }
  return { id: usuario.id, aplicativoId: usuario.aplicativoId };
}
