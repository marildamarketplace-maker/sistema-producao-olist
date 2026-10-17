"use server";

import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { prisma } from "@/lib/prisma";
import { consultarCatalogoAutorizado } from "@/lib/calendario-comercial/acesso";
import { catalogoComercial } from "@/lib/calendario-comercial/catalogo";

export async function carregarCalendario(token: string) {
  return consultarCatalogoAutorizado(typeof token === "string" ? token : null, {
    autenticar: async (accessToken) => {
      const autenticado = await getUsuarioAutenticado(new Request("http://localhost/calendario", {
        headers: { authorization: `Bearer ${accessToken}` },
      }));
      return prisma.usuario.findFirst({
        where: { id: autenticado.id, aplicativoId: autenticado.aplicativoId, ativo: true },
        select: { ativo: true, podeVisualizarTarefasMidia: true },
      });
    },
    carregar: () => catalogoComercial,
  });
}
