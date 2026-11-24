import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { permissionKeys, type PermissionKey } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  alterarVendedorOlistLegado, ErroVinculoVendedorOlist, listarAplicativosElegiveis,
  substituirVendedoresOlist, vendedorOlistEntradaSchema,
} from "@/lib/usuario-vendedor-olist";

class ErroUsuarios extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function getAdministrador(request: Request) {
  const autenticado = await getUsuarioAutenticado(request).catch(() => null);
  if (!autenticado) throw new ErroUsuarios("Sessão inválida ou expirada.", 401);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { id: true, aplicativoId: true, podeEditarConfiguracao: true },
  });
  if (!usuario?.podeEditarConfiguracao) throw new ErroUsuarios("Sem permissão para administrar usuários.", 403);
  return usuario;
}

const selectResumo = {
  id: true, nome: true, email: true, ativo: true, vinculosOlistVersao: true,
  _count: { select: { vendedoresOlist: true } },
} satisfies Prisma.UsuarioSelect;
const selectPermissoes = Object.fromEntries(permissionKeys.map((permission) => [permission, true])) as Record<PermissionKey, true>;
const selecionarResumo = (aplicativoId: string) => ({
  ...selectResumo,
  vendedoresOlist: { where: { aplicativoId }, select: { vendedorOlistId: true }, take: 1 },
}) satisfies Prisma.UsuarioSelect;
const selectDetalhe = {
  ...selectResumo, ...selectPermissoes,
  vendedoresOlist: { select: { aplicativoId: true, vendedorOlistId: true }, orderBy: { aplicativoId: "asc" }, take: 1001 },
} satisfies Prisma.UsuarioSelect;
type ResumoSelecionado = Prisma.UsuarioGetPayload<{ select: ReturnType<typeof selecionarResumo> }>;
type DetalheSelecionado = Prisma.UsuarioGetPayload<{ select: typeof selectDetalhe }>;

function resumo(usuario: ResumoSelecionado) {
  const { _count, vendedoresOlist, ...dados } = usuario;
  return { ...dados, vendedoresOlistQuantidade: _count.vendedoresOlist, vendedorOlistId: vendedoresOlist[0]?.vendedorOlistId ?? null };
}
function detalhe(usuario: DetalheSelecionado, aplicativoId: string) {
  if (usuario.vendedoresOlist.length > 1000) throw new ErroUsuarios("Este cadastro excede o limite de 1.000 vínculos. Revise os dados antes de editar.", 409);
  const { _count, ...dados } = usuario;
  return { ...dados, vendedoresOlistQuantidade: _count.vendedoresOlist,
    vendedorOlistId: usuario.vendedoresOlist.find((vinculo) => vinculo.aplicativoId === aplicativoId)?.vendedorOlistId ?? null };
}

const vendedorLegadoSchema = z.preprocess((valor) => {
  if (valor === null || valor === "") return null;
  return typeof valor === "string" && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
}, z.number().int().positive().max(2147483647).nullable());
const vinculosShape = {
  vendedoresOlist: vendedorOlistEntradaSchema.optional(),
  vendedorOlistId: vendedorLegadoSchema.optional(),
};
const nomeSchema = z.string().trim().min(2).max(200);
const emailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email());
const permissoesSchema = z.partialRecord(z.enum(permissionKeys), z.boolean());
const criacaoSchema = z.object({
  nome: nomeSchema, email: emailSchema, senha: z.string().min(6).max(256),
  ...vinculosShape, permissions: permissoesSchema.optional(),
}).strict().refine((body) => body.vendedoresOlist === undefined || body.vendedorOlistId === undefined,
  { message: "Envie a coleção de vendedores ou o campo legado, nunca ambos." });
const perfilSchema = z.object({
  nome: nomeSchema, email: emailSchema, ativo: z.boolean(), ...vinculosShape,
  vinculosOlistVersao: z.number().int().nonnegative().max(2147483647).optional(),
}).strict().refine((body) => body.vendedoresOlist === undefined || body.vendedorOlistId === undefined,
  { message: "Envie a coleção de vendedores ou o campo legado, nunca ambos." })
  .refine((body) => body.vendedoresOlist === undefined || body.vinculosOlistVersao !== undefined,
    { message: "Recarregue os vínculos antes de salvar." });
const atualizacaoSchema = z.union([
  z.object({ usuarioId: z.guid(), profile: perfilSchema }).strict(),
  z.object({ usuarioId: z.guid(), all: z.boolean() }).strict(),
  z.object({ usuarioId: z.guid(), permission: z.enum(permissionKeys), value: z.boolean() }).strict(),
]);

function falha(error: unknown) {
  if (error instanceof ErroUsuarios || error instanceof ErroVinculoVendedorOlist) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Revise os dados informados." }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Já existe um usuário com este e-mail no aplicativo." }, { status: 409 });
  return NextResponse.json({ error: "Não foi possível concluir a operação. Tente novamente." }, { status: 500 });
}
const responder = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const params = new URL(request.url).searchParams;
    if (params.get("recurso") === "aplicativos") return responder({ aplicativos: await listarAplicativosElegiveis(administrador.aplicativoId) });
    if (params.has("recurso")) throw new ErroUsuarios("Recurso inválido.");
    if (params.has("usuarioId")) {
      const usuarioId = z.guid().parse(params.get("usuarioId"));
      const usuario = await prisma.usuario.findFirst({ where: { id: usuarioId, aplicativoId: administrador.aplicativoId }, select: selectDetalhe });
      if (!usuario) throw new ErroUsuarios("Usuário não encontrado neste aplicativo.", 404);
      return responder({ usuario: detalhe(usuario, administrador.aplicativoId) });
    }
    const pagina = z.coerce.number().int().min(1).max(1000000).parse(params.get("pagina") ?? 1);
    const limite = z.coerce.number().int().positive().transform((valor) => Math.min(valor, 100)).parse(params.get("limite") ?? 50);
    const where = { aplicativoId: administrador.aplicativoId };
    const [usuarios, total] = await Promise.all([
      prisma.usuario.findMany({ where, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (pagina - 1) * limite, take: limite, select: selecionarResumo(administrador.aplicativoId) }),
      prisma.usuario.count({ where }),
    ]);
    return responder({ usuarios: usuarios.map(resumo), paginacao: { pagina, limite, total, totalPaginas: Math.max(1, Math.ceil(total / limite)) } });
  } catch (error) { return falha(error); }
}

export async function POST(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const body = criacaoSchema.parse(await request.json().catch(() => null));
    if (body.vendedoresOlist?.length) {
      const elegiveis = new Set((await listarAplicativosElegiveis(administrador.aplicativoId)).map((app) => app.id));
      if (body.vendedoresOlist.some((vinculo) => !elegiveis.has(vinculo.aplicativoId))) throw new ErroUsuarios("Selecione somente o aplicativo próprio ou seus filhos diretos.");
    }
    const existente = await prisma.usuario.findFirst({ where: { aplicativoId: administrador.aplicativoId, email: { equals: body.email, mode: "insensitive" } }, select: { id: true } });
    if (existente) throw new ErroUsuarios("Já existe um usuário com este e-mail no aplicativo.", 409);
    const permissoes = Object.fromEntries(permissionKeys.map((permission) => [permission, body.permissions?.[permission] ?? false])) as Record<PermissionKey, boolean>;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: body.email, password: body.senha, email_confirm: true, user_metadata: { nome: body.nome } });
    if (error || !data.user) throw new ErroUsuarios("Não foi possível criar o acesso no Authentication. Confira o e-mail e tente novamente.");
    const authId = data.user.id;
    try {
      const usuario = await prisma.$transaction(async (tx) => {
        await tx.usuario.create({ data: { id: authId, aplicativoId: administrador.aplicativoId, nome: body.nome, email: body.email, ativo: true, ...permissoes }, select: { id: true } });
        if (body.vendedoresOlist !== undefined) await substituirVendedoresOlist(tx, authId, administrador.aplicativoId, body.vendedoresOlist, 0);
        else if (body.vendedorOlistId !== undefined) await alterarVendedorOlistLegado(tx, authId, administrador.aplicativoId, body.vendedorOlistId);
        return tx.usuario.findUniqueOrThrow({ where: { id: authId }, select: selectDetalhe });
      });
      return responder({ usuario: detalhe(usuario, administrador.aplicativoId) }, 201);
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(authId);
      throw error;
    }
  } catch (error) { return falha(error); }
}

export async function PATCH(request: Request) {
  try {
    const administrador = await getAdministrador(request);
    const body = atualizacaoSchema.parse(await request.json().catch(() => null));
    const alvo = await prisma.usuario.findFirst({ where: { id: body.usuarioId, aplicativoId: administrador.aplicativoId }, select: { id: true, nome: true, email: true, vinculosOlistVersao: true } });
    if (!alvo) throw new ErroUsuarios("Usuário não encontrado neste aplicativo.", 404);
    if ("profile" in body) {
      const perfil = body.profile;
      const versao = perfil.vinculosOlistVersao;
      if (perfil.vendedoresOlist !== undefined && versao === undefined) throw new ErroUsuarios("Recarregue os vínculos antes de salvar.");
      if (perfil.vendedoresOlist !== undefined && alvo.vinculosOlistVersao !== versao) throw new ErroUsuarios("Os vínculos foram alterados. Recarregue o usuário antes de salvar.", 409);
      if (perfil.vendedoresOlist?.length) {
        const elegiveis = new Set((await listarAplicativosElegiveis(administrador.aplicativoId)).map((app) => app.id));
        if (perfil.vendedoresOlist.some((vinculo) => !elegiveis.has(vinculo.aplicativoId))) throw new ErroUsuarios("Selecione somente o aplicativo próprio ou seus filhos diretos.");
      }
      const duplicado = await prisma.usuario.findFirst({ where: { aplicativoId: administrador.aplicativoId, id: { not: body.usuarioId }, email: { equals: perfil.email, mode: "insensitive" } }, select: { id: true } });
      if (duplicado) throw new ErroUsuarios("Já existe outro usuário com este e-mail.", 409);
      let acessoAtualizado = false;
      if (alvo.email !== perfil.email || alvo.nome !== perfil.nome) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(body.usuarioId, { email: perfil.email, user_metadata: { nome: perfil.nome } });
        if (error) throw new ErroUsuarios("Não foi possível atualizar o acesso no Authentication. Confira os dados e tente novamente.");
        acessoAtualizado = true;
      }
      const usuario = await prisma.$transaction(async (tx) => {
        if (perfil.vendedoresOlist !== undefined && versao !== undefined) await substituirVendedoresOlist(tx, body.usuarioId, administrador.aplicativoId, perfil.vendedoresOlist, versao);
        else if (perfil.vendedorOlistId !== undefined) await alterarVendedorOlistLegado(tx, body.usuarioId, administrador.aplicativoId, perfil.vendedorOlistId);
        return tx.usuario.update({ where: { id: body.usuarioId, aplicativoId: administrador.aplicativoId }, data: { nome: perfil.nome, email: perfil.email, ativo: perfil.ativo }, select: selectDetalhe });
      }).catch((error: unknown) => {
        if (!acessoAtualizado) throw error;
        const status = error instanceof ErroVinculoVendedorOlist ? error.status : 500;
        throw new ErroUsuarios("O acesso foi atualizado no Authentication, mas não foi possível confirmar o perfil e os vínculos. Recarregue o usuário e confira os dados antes de tentar novamente.", status);
      });
      return responder({ usuario: detalhe(usuario, administrador.aplicativoId) });
    }
    const data = "all" in body
      ? Object.fromEntries(permissionKeys.map((permission) => [permission, body.all])) as Record<PermissionKey, boolean>
      : { [body.permission]: body.value };
    const usuario = await prisma.usuario.update({ where: { id: body.usuarioId, aplicativoId: administrador.aplicativoId }, data, select: selectDetalhe });
    return responder({ usuario: detalhe(usuario, administrador.aplicativoId) });
  } catch (error) { return falha(error); }
}
