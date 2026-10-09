import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { criarHandlersAcessos } from "@/lib/acessos-paginas";

export const dynamic = "force-dynamic";
const handlers = criarHandlersAcessos({
  async autenticar(request) {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7));
    if (error || !data.user?.email) return null;
    // Mesmo vínculo por id/email utilizado pelo restante da aplicação.
    return prisma.usuario.findFirst({ where: { ativo: true, OR: [
      { id: data.user.id }, { email: { equals: data.user.email.trim(), mode: "insensitive" } },
    ] } });
  },
  listar: (usuarioId) => prisma.acessoPaginaUsuario.findMany({
    where: { usuarioId }, select: { pagina: true, acessos: true },
  }),
  async incrementar(usuarioId, pagina) {
    // Um único statement evita perder incrementos em acessos concorrentes.
    await prisma.$executeRaw`
      INSERT INTO acesso_pagina_usuario (usuario_id, pagina, acessos, ultimo_acesso)
      VALUES (${usuarioId}::uuid, ${pagina}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (usuario_id, pagina) DO UPDATE
      SET acessos = acesso_pagina_usuario.acessos + 1, ultimo_acesso = CURRENT_TIMESTAMP
    `;
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
