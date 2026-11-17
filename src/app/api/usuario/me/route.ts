import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import {
  permissionKeys, permissoesSincronizacaoParaAplicativo, syncPermissionKeys,
  type PermissionKey, type PermissionSet,
} from "@/lib/permissions";

const selectPermissoes = Object.fromEntries(permissionKeys.map((chave) => [chave, true])) as Record<PermissionKey, true>;
const selectUsuario = {
  id: true, nome: true, email: true, aplicativoId: true, vendedorOlistId: true,
  aplicativo: { select: { nome: true } }, ...selectPermissoes,
} satisfies Prisma.UsuarioSelect;

export async function GET(request: Request) {
  try {
    const autenticado = await getUsuarioAutenticado(request);
    const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: selectUsuario });
    if (!usuario) return NextResponse.json({ error: "Usuário sem cadastro ativo neste aplicativo." }, { status: 403 });
    const permissoes = Object.fromEntries(permissionKeys.map((chave) => [chave, usuario[chave] === true])) as PermissionSet;
    // A configuração identifica a autoridade do grupo. Ser filho ou ter flags isoladas não concede acesso.
    const grupo = syncPermissionKeys.some((chave) => permissoes[chave])
      ? await prisma.olistSyncConfiguracao.findUnique({
        where: { aplicativoPaiId: usuario.aplicativoId }, select: { id: true },
      })
      : null;
    const aplicativoAdministraSincronizacaoOlist = grupo !== null;
    return NextResponse.json({
      id: usuario.id, nome: usuario.nome, email: usuario.email, aplicativo_id: usuario.aplicativoId,
      vendedorOlistId: usuario.vendedorOlistId, aplicativo: usuario.aplicativo,
      aplicativoAdministraSincronizacaoOlist,
      ...permissoes,
      ...permissoesSincronizacaoParaAplicativo(permissoes, aplicativoAdministraSincronizacaoOlist),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const autenticacao = error instanceof Error && /Token de autenticação/.test(error.message);
    return NextResponse.json({ error: autenticacao ? error.message : "Não foi possível validar o acesso ao aplicativo." }, { status: autenticacao ? 401 : 403 });
  }
}
