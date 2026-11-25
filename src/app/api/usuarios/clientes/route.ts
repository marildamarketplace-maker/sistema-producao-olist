import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { bloquearRelacaoFornecedor } from "@/lib/fornecedor-relacao";
import {
  ErroVinculoVendedorOlist,
  aplicativosExternosElegiveisWhere,
  substituirVendedoresExternosOlist, vendedorOlistEntradaSchema,
} from "@/lib/usuario-vendedor-olist";

type ClienteBanco = Prisma.TransactionClient;
const identidade = { id: true, nome: true, aplicativoId: true, aplicativo: { select: { id: true, nome: true } } } satisfies Prisma.UsuarioSelect;
type Identidade = Prisma.UsuarioGetPayload<{ select: typeof identidade }>;

const responder = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
const entrada = z.object({
  usuarioId: z.guid(),
  vinculosOlistVersao: z.number().int().nonnegative().max(2147483647),
  vendedoresOlist: vendedorOlistEntradaSchema,
}).strict();

function elegibilidade(matrizId: string) {
  return {
    aplicativoId: { not: matrizId },
    aplicativo: { fornecedores: { some: { aplicativoPaiId: matrizId, ativo: true } } },
  } satisfies Prisma.UsuarioWhereInput;
}

async function administrador(request: Request) {
  const auth = await getUsuarioAutenticado(request).catch(() => null);
  if (!auth) throw new ErroVinculoVendedorOlist("Sessão inválida ou expirada.", 401);
  const usuario = await prisma.usuario.findUnique({ where: { id: auth.id }, select: {
    id: true, ativo: true, aplicativoId: true, podeEditarConfiguracao: true,
    aplicativo: { select: { aplicativoPaiId: true } },
  } });
  if (!usuario?.ativo || !usuario.podeEditarConfiguracao || usuario.aplicativo.aplicativoPaiId !== null) {
    throw new ErroVinculoVendedorOlist("Somente um administrador da matriz pode configurar vendedores dos aplicativos clientes.", 403);
  }
  return usuario;
}

function resumo(usuario: Identidade) {
  return { id: usuario.id, nome: usuario.nome, aplicativo: usuario.aplicativo };
}

async function detalhe(banco: ClienteBanco, usuario: Identidade, matrizId: string) {
  const contasExternas = aplicativosExternosElegiveisWhere(matrizId, usuario.aplicativoId);
  const [atual, vinculos, aplicativos] = await Promise.all([
    banco.usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { vinculosOlistVersao: true } }),
    banco.usuarioVendedorOlist.findMany({
      where: { usuarioId: usuario.id, origemAplicativoId: usuario.aplicativoId, fornecedorMatrizId: matrizId,
        aplicativo: contasExternas },
      select: { aplicativoId: true, vendedorOlistId: true, confirmadoEm: true, revogadoEm: true },
      orderBy: { aplicativoId: "asc" }, take: 1001,
    }),
    banco.aplicativo.findMany({ where: contasExternas,
      select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001 }),
  ]);
  if (vinculos.length > 1000 || aplicativos.length > 1000) throw new ErroVinculoVendedorOlist("Limite de empresas excedido. Revise o grupo antes de configurar vendedores.", 409);
  return { usuario: { ...resumo(usuario), vinculosOlistVersao: atual.vinculosOlistVersao,
    vendedoresOlist: vinculos.map(v => ({ aplicativoId: v.aplicativoId, vendedorOlistId: v.vendedorOlistId,
      confirmado: v.confirmadoEm !== null && v.revogadoEm === null })) }, aplicativos };
}

function falha(error: unknown) {
  if (error instanceof ErroVinculoVendedorOlist) return responder({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return responder({ error: "Informe usuário, versão e vínculos de vendedor válidos." }, 400);
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code)) {
    return responder({ error: "Os dados foram alterados durante o salvamento. Recarregue os vínculos e tente novamente." }, 409);
  }
  return responder({ error: "Não foi possível concluir a configuração dos vendedores. Tente novamente." }, 500);
}

export async function GET(request: Request) {
  try {
    const admin = await administrador(request);
    const params = new URL(request.url).searchParams;
    if (params.has("usuarioId")) {
      const usuarioId = z.guid().parse(params.get("usuarioId"));
      const retorno = await prisma.$transaction(async tx => {
        const usuario = await tx.usuario.findFirst({ where: { id: usuarioId, ...elegibilidade(admin.aplicativoId) }, select: identidade });
        if (!usuario) throw new ErroVinculoVendedorOlist("Usuário cliente não disponível para este fornecedor.", 404);
        return detalhe(tx, usuario, admin.aplicativoId);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 10000 });
      return responder(retorno);
    }
    const pagina = z.coerce.number().int().min(1).max(1000000).parse(params.get("pagina") ?? 1);
    const limite = z.coerce.number().int().positive().transform(n => Math.min(n, 100)).parse(params.get("limite") ?? 50);
    const where = elegibilidade(admin.aplicativoId);
    const [usuarios, total] = await Promise.all([
      prisma.usuario.findMany({ where, select: identidade, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (pagina - 1) * limite, take: limite }),
      prisma.usuario.count({ where }),
    ]);
    return responder({ usuarios: usuarios.map(resumo), paginacao: { pagina, limite, total, totalPaginas: Math.max(1, Math.ceil(total / limite)) } });
  } catch (error) { return falha(error); }
}

export async function PATCH(request: Request) {
  try {
    const admin = await administrador(request);
    const body = entrada.parse(await request.json().catch(() => null));
    const alvo = await prisma.usuario.findFirst({ where: { id: body.usuarioId, ...elegibilidade(admin.aplicativoId) }, select: identidade });
    if (!alvo) throw new ErroVinculoVendedorOlist("Usuário cliente não disponível para este fornecedor.", 404);
    const retorno = await prisma.$transaction(async tx => {
      await bloquearRelacaoFornecedor(tx, alvo.aplicativoId, admin.aplicativoId);
      const ids = [...new Set([admin.id, alvo.id])].sort();
      await tx.$queryRaw(Prisma.sql`SELECT id FROM usuario WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
      const operador = await tx.usuario.findUnique({ where: { id: admin.id }, select: {
        ativo: true, aplicativoId: true, podeEditarConfiguracao: true, aplicativo: { select: { aplicativoPaiId: true } },
      } });
      if (!operador?.ativo || !operador.podeEditarConfiguracao || operador.aplicativoId !== admin.aplicativoId || operador.aplicativo.aplicativoPaiId !== null) {
        throw new ErroVinculoVendedorOlist("Permissão para configurar vendedores alterada. Atualize a página.", 403);
      }
      const usuario = await tx.usuario.findFirst({ where: { id: alvo.id, ...elegibilidade(admin.aplicativoId), AND: { aplicativoId: alvo.aplicativoId } }, select: identidade });
      if (!usuario) throw new ErroVinculoVendedorOlist("A relação de fornecimento foi encerrada. Atualize a página.", 409);
      await substituirVendedoresExternosOlist(tx, usuario.id, usuario.aplicativoId, admin.aplicativoId,
        body.vendedoresOlist, body.vinculosOlistVersao, admin.id);
      return detalhe(tx, usuario, admin.aplicativoId);
    }, { maxWait: 5000, timeout: 10000 });
    return responder(retorno);
  } catch (error) { return falha(error); }
}
