import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroBuscaVisual } from "./imagem";

export async function autorizarPesquisa(request: Request) {
  let autenticado;
  try { autenticado = await getUsuarioAutenticado(request); }
  catch { throw new ErroBuscaVisual("Autenticação necessária.", 401); }
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { podeVisualizarEstampas: true, podeEditarEstampas: true, podeCriarMockups: true },
  });
  if (!usuario || (!usuario.podeVisualizarEstampas && !usuario.podeEditarEstampas && !usuario.podeCriarMockups)) {
    throw new ErroBuscaVisual("Sem permissão para pesquisar estampas.", 403);
  }
  return autenticado;
}

