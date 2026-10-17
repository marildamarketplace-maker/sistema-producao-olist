import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";

/** A origem só pode consultar uma filial do fornecedor cadastrado em seu aplicativo. */
export async function autorizarOlistOrigem(request: Request, entrada: { fornecedorId: string; filialId: string; solicitacaoId: string }) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroFilaOlist("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: { aplicativoId: true, podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true } });
  if (!usuario?.aplicativoId || !usuario.podeSolicitarProducao || !usuario.podeSelecionarFilialFornecedor) throw new ErroFilaOlist("Sem permissão para selecionar dados da filial do fornecedor.", 403);
  const solicitacao = await prisma.solicitacaoProducao.findFirst({ where: { id: entrada.solicitacaoId, aplicativoId: usuario.aplicativoId, status: "em_producao" }, select: { id: true } });
  if (!solicitacao) throw new ErroFilaOlist("Solicitação em produção não encontrada neste aplicativo.", 404);
  const fornecedor = await prisma.fornecedor.findFirst({ where: { id: entrada.fornecedorId, aplicativoId: usuario.aplicativoId }, select: { aplicativoPaiId: true, aplicativoPai: { select: { aplicativoPaiId: true } } } });
  if (!fornecedor?.aplicativoPaiId || fornecedor.aplicativoPai.aplicativoPaiId !== null) throw new ErroFilaOlist("Fornecedor não encontrado neste aplicativo.", 404);
  const filial = await prisma.aplicativo.findFirst({ where: { id: entrada.filialId, aplicativoPaiId: fornecedor.aplicativoPaiId }, select: { id: true, nome: true } });
  if (!filial) throw new ErroFilaOlist("Filial não vinculada ao fornecedor selecionado.", 403);
  return filial;
}
