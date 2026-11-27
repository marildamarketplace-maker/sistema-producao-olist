"use server";

import { consultarDivulgacao } from "@/lib/calendario-comercial/divulgacao";
import { listarDivulgacao } from "@/lib/calendario-comercial/divulgacao-repository";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { prisma } from "@/lib/prisma";

export async function carregarDivulgacao(token: string, entrada: unknown) {
  return consultarDivulgacao(token, entrada, {
    autenticar: async (accessToken) => {
      const autenticado = await getUsuarioAutenticado(new Request("http://localhost/calendario/divulgacao", {
        headers: { authorization: `Bearer ${accessToken}` },
      }));
      return prisma.usuario.findFirst({
        where: { id: autenticado.id, aplicativoId: autenticado.aplicativoId, ativo: true },
        select: { ativo: true, aplicativoId: true, podeVisualizarTarefasMidia: true,
          podeVisualizarEstoque: true, podeEditarEstoque: true },
      });
    },
    consultar: listarDivulgacao,
  });
}
