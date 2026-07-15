import { NextResponse } from "next/server";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { permissionKeys, type PermissionKey } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getAdministrador(request: Request) {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { id: true, aplicativoId: true, podeEditarConfiguracao: true },
  });
  if (!usuario?.podeEditarConfiguracao) throw new Error("Sem permissão para administrar usuários.");
  return usuario;
}

const selectUsuario = Object.fromEntries([
  ["id", true], ["nome", true], ["email", true], ["ativo", true], ["vendedorOlistId", true],
  ...permissionKeys.map((permission) => [permission, true]),
]);

export async function GET(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const usuarios = await prisma.usuario.findMany({
      where: { aplicativoId: administrador.aplicativoId },
      orderBy: { nome: "asc" },
      select: selectUsuario,
    });
    return NextResponse.json({ usuarios });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao listar usuários." }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const body = await request.json() as { nome?: unknown; email?: unknown; senha?: unknown; vendedorOlistId?: unknown };
    const nome = String(body.nome ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const senha = String(body.senha ?? "");
    const vendedorTexto = String(body.vendedorOlistId ?? "").trim();
    const vendedorOlistId = vendedorTexto ? Number(vendedorTexto) : null;
    if (nome.length < 2) throw new Error("Informe o nome do usuário.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
    if (senha.length < 6) throw new Error("A senha deve possuir pelo menos 6 caracteres.");
    if (vendedorOlistId !== null && (!Number.isInteger(vendedorOlistId) || vendedorOlistId <= 0)) throw new Error("Informe um ID de vendedor válido.");
    const existente = await prisma.usuario.findFirst({ where: { aplicativoId: administrador.aplicativoId, email: { equals: email, mode: "insensitive" } } });
    if (existente) throw new Error("Já existe um usuário com este e-mail no aplicativo.");

    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
    if (error || !data.user) throw new Error(`Não foi possível criar o usuário no Authentication: ${error?.message ?? "usuário não criado"}`);
    try {
      const usuario = await prisma.usuario.create({
        data: { id: data.user.id, aplicativoId: administrador.aplicativoId, nome, email, vendedorOlistId, ativo: true },
        select: selectUsuario,
      });
      return NextResponse.json({ usuario }, { status: 201 });
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao criar usuário." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const body = await request.json() as { usuarioId?: unknown; permission?: unknown; value?: unknown; all?: unknown; profile?: { nome?: unknown; email?: unknown; vendedorOlistId?: unknown; ativo?: unknown } };
    const usuarioId = String(body.usuarioId ?? "");
    const alvo = await prisma.usuario.findFirst({ where: { id: usuarioId, aplicativoId: administrador.aplicativoId } });
    if (!alvo) throw new Error("Usuário não encontrado neste aplicativo.");

    if (body.profile) {
      const nome = String(body.profile.nome ?? "").trim();
      const email = String(body.profile.email ?? "").trim().toLowerCase();
      const vendedorTexto = String(body.profile.vendedorOlistId ?? "").trim();
      const vendedorOlistId = vendedorTexto ? Number(vendedorTexto) : null;
      if (nome.length < 2) throw new Error("Informe o nome do usuário.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
      if (vendedorOlistId !== null && (!Number.isInteger(vendedorOlistId) || vendedorOlistId <= 0)) throw new Error("Informe um ID de vendedor válido.");
      const duplicado = await prisma.usuario.findFirst({ where: { aplicativoId: administrador.aplicativoId, id: { not: usuarioId }, email: { equals: email, mode: "insensitive" } } });
      if (duplicado) throw new Error("Já existe outro usuário com este e-mail.");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(usuarioId, { email, user_metadata: { nome } });
      if (error) throw new Error(`Não foi possível atualizar o acesso: ${error.message}`);
      const usuario = await prisma.usuario.update({ where: { id: usuarioId }, data: { nome, email, vendedorOlistId, ativo: Boolean(body.profile.ativo) }, select: selectUsuario });
      return NextResponse.json({ usuario });
    }

    let data: Partial<Record<PermissionKey, boolean>>;
    if (typeof body.all === "boolean") {
      data = Object.fromEntries(permissionKeys.map((permission) => [permission, body.all])) as Partial<Record<PermissionKey, boolean>>;
    } else {
      const permission = String(body.permission ?? "") as PermissionKey;
      if (!permissionKeys.includes(permission)) throw new Error("Permissão inválida.");
      data = { [permission]: Boolean(body.value) };
    }
    const usuario = await prisma.usuario.update({ where: { id: usuarioId }, data, select: selectUsuario });
    return NextResponse.json({ usuario });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar permissões." }, { status: 400 });
  }
}
