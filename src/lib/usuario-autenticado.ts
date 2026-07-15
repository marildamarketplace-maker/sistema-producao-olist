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

  const usuario = await prisma.usuario.findFirst({
    where: {
      ativo: true,
      OR: [
        { id: authUser.id },
        { email: { equals: email.trim(), mode: "insensitive" } },
      ],
    },
    select: { id: true, aplicativoId: true },
  });

  if (!usuario) {
    throw new Error(`Usuário ${email.trim()} sem cadastro ativo no banco da aplicação.`);
  }
  return { id: usuario.id, aplicativoId: usuario.aplicativoId };
}
