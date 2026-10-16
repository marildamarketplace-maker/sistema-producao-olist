import { prisma } from "./prisma";
import { getUsuarioAutenticado } from "./usuario-autenticado";
import { DetalheProducaoError } from "./producao-detalhes-contrato";
export { DetalheProducaoError } from "./producao-detalhes-contrato";

export async function autorizarDetalheProducao(request: Request, id: string, editar = false) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new DetalheProducaoError("Identificador da produção inválido.", 400);
  }
  let autenticado;
  try { autenticado = await getUsuarioAutenticado(request); } catch {
    throw new DetalheProducaoError("Sessão expirada. Entre novamente.", 401);
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { podeSolicitarProducao: true, podeVisualizarProducao: true },
  });
  if (!usuario || (editar ? !usuario.podeSolicitarProducao : !usuario.podeSolicitarProducao && !usuario.podeVisualizarProducao)) {
    throw new DetalheProducaoError(editar ? "Sem permissão para editar esta produção." : "Sem permissão para visualizar esta produção.", 403);
  }
  return autenticado;
}

export function respostaErroDetalheProducao(error: unknown) {
  if (error instanceof DetalheProducaoError) return { mensagem: error.message, status: error.status };
  console.error("[producao-detalhes] Falha ao carregar produção.");
  return { mensagem: "Não foi possível carregar os dados da produção.", status: 500 };
}
