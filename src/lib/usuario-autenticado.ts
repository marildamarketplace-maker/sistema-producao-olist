import { supabaseAdmin } from "@/lib/supabase-admin";
import { prisma } from "@/lib/prisma";

export async function getUsuarioAutenticado(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) throw new Error("Token de autenticação ausente.");

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  const authUser = authData.user;
  const email = authUser?.email;
  if (authError || !authUser || !email) throw new Error("Token de autenticação inválido.");

  const select = {
      id: true,
      ativo: true,
      aplicativoId: true,
      vendedorOlistId: true,
      podeEditarConfiguracao: true,
      podeVisualizarOlistFormasPagamento: true,
      podeVisualizarOlistFormasRecebimento: true,
    } as const;
  // O UUID autenticado tem precedência. E-mails repetidos em tenants diferentes
  // nunca podem escolher arbitrariamente o primeiro cadastro.
  let usuario = await prisma.usuario.findFirst({ where: { id: authUser.id }, select });
  if (usuario?.ativo === false) throw new Error("Token vinculado a um usuário desativado.");
  if (!usuario && authUser.email_confirmed_at) {
    const candidatos = await prisma.usuario.findMany({
      where: { ativo: true, email: { equals: email.trim(), mode: "insensitive" } },
      select, take: 2,
    });
    if (candidatos.length === 1) usuario = candidatos[0];
  }

  if (!usuario) {
    throw new Error("Token sem vínculo inequívoco com um usuário ativo da aplicação.");
  }
  return usuario;
}
