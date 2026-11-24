import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroFilaOlist } from "@/lib/fila-olist-cadastros";
import { destinoFornecedorWhere } from "@/lib/fila-fornecedor-destino";

/** A origem só consulta a própria conta do fornecedor cadastrado ou um filho direto. */
export async function autorizarOlistOrigem(request: Request, entrada: { fornecedorId: string; filialId: string; solicitacaoId: string }) {
  const auth = await getUsuarioAutenticado(request).catch(() => { throw new ErroFilaOlist("Sessão inválida ou expirada.", 401); });
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: { aplicativoId: true, podeSolicitarProducao: true, podeSelecionarFilialFornecedor: true } });
  if (!usuario?.aplicativoId || !usuario.podeSolicitarProducao || !usuario.podeSelecionarFilialFornecedor) throw new ErroFilaOlist("Sem permissão para selecionar dados da conta destinatária do fornecedor.", 403);
  const solicitacao = await prisma.solicitacaoProducao.findFirst({ where: { id: entrada.solicitacaoId, aplicativoId: usuario.aplicativoId, status: "em_producao" }, select: { id: true } });
  if (!solicitacao) throw new ErroFilaOlist("Solicitação em produção não encontrada neste aplicativo.", 404);
  const fornecedor = await prisma.fornecedor.findFirst({ where: { id: entrada.fornecedorId, aplicativoId: usuario.aplicativoId }, select: { aplicativoPaiId: true, aplicativoPai: { select: { aplicativoPaiId: true } } } });
  if (!fornecedor?.aplicativoPaiId || fornecedor.aplicativoPai.aplicativoPaiId !== null) throw new ErroFilaOlist("Fornecedor não encontrado neste aplicativo.", 404);
  const filial = await prisma.aplicativo.findFirst({ where: destinoFornecedorWhere(fornecedor.aplicativoPaiId, entrada.filialId), select: { id: true, nome: true } });
  if (!filial) throw new ErroFilaOlist("Aplicativo destinatário não vinculado ao fornecedor selecionado.", 403);
  return { ...filial, usuarioId: auth.id };
}
