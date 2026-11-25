import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { bloquearRelacaoFornecedor } from "@/lib/fornecedor-relacao";

const entrada = z.object({
  id: z.guid().nullable(), aplicativo_pai_id: z.guid(),
  nome: z.string().trim().min(1).max(200), endereco: z.string().trim().max(2000).nullable(),
}).strict();
class ErroCadastro extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const resposta = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: { "Cache-Control": "private, no-store" } });
async function autorizar(request: Request) {
  const usuario = await getUsuarioAutenticado(request).catch(() => null);
  if (!usuario) throw new ErroCadastro("Sessão inválida ou expirada.", 401);
  const perfil = await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { ativo: true, podeVisualizarFornecedores: true, aplicativoId: true } });
  if (!perfil?.ativo || !perfil.podeVisualizarFornecedores) throw new ErroCadastro("Sem permissão para cadastrar fornecedores.", 403);
  return { id: usuario.id, aplicativoId: perfil.aplicativoId };
}
async function revalidar(tx: Prisma.TransactionClient, usuario: { id: string; aplicativoId: string }) {
  await tx.$queryRaw`SELECT id FROM usuario WHERE id=${usuario.id}::uuid FOR SHARE`;
  const atual = await tx.usuario.findUnique({ where: { id: usuario.id }, select: { ativo: true, aplicativoId: true, podeVisualizarFornecedores: true } });
  if (!atual?.ativo || atual.aplicativoId !== usuario.aplicativoId || !atual.podeVisualizarFornecedores) throw new ErroCadastro("Permissões alteradas. Atualize a página.", 403);
}
async function transacao<T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try { return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('lock_timeout','5s',true), set_config('statement_timeout','10s',true)`;
      return operacao(tx);
    }, { maxWait: 5000, timeout: 15000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || tentativa >= 2) throw error;
    }
  }
}
function falha(error: unknown) {
  if (error instanceof ErroCadastro) return resposta({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return resposta({ error: "Informe os dados do fornecedor e um aplicativo pai válidos." }, 400);
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P2003" || code === "P2004") return resposta({ error: "Um dos vínculos do fornecedor é inválido. Atualize os dados e tente novamente." }, 400);
  if (code === "P2034" || code === "P2028" || code === "P2010") return resposta({ error: "O cadastro está sendo alterado ou excedeu o prazo. Atualize e tente novamente." }, 409);
  return resposta({ error: "Não foi possível salvar o fornecedor. Tente novamente." }, 500);
}
export async function POST(request: Request) {
  try {
    const usuario = await autorizar(request);
    const body = entrada.parse(await request.json().catch(() => null));
    const resultado = await transacao(async tx => {
      const anterior = body.id ? await tx.fornecedor.findFirst({ where: { id: body.id, aplicativoId: usuario.aplicativoId, ativo: true }, select: { id: true, aplicativoPaiId: true } }) : null;
      if (body.id && !anterior) throw new ErroCadastro("Fornecedor ativo não encontrado neste aplicativo.", 404);
      for (const matriz of [...new Set([body.aplicativo_pai_id, ...(anterior ? [anterior.aplicativoPaiId] : [])])].sort()) await bloquearRelacaoFornecedor(tx, usuario.aplicativoId, matriz);
      await revalidar(tx, usuario);
      const pais = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aplicativo WHERE id=${body.aplicativo_pai_id}::uuid AND aplicativo_pai_id IS NULL FOR SHARE`;
      if (!pais.length) throw new ErroCadastro("Selecione um aplicativo pai, não uma filial.");
      const data = { nome: body.nome, endereco: body.endereco, updatedAt: new Date() };
      if (anterior) {
        // Uma troca encerra o cadastro anterior: referências históricas não mudam de empresa.
        const trocou = anterior.aplicativoPaiId !== body.aplicativo_pai_id;
        const atualizado = await tx.fornecedor.updateMany({ where: { id: anterior.id, aplicativoId: usuario.aplicativoId, aplicativoPaiId: anterior.aplicativoPaiId, ativo: true },
          data: trocou ? { ativo: false, encerradoEm: new Date() } : data });
        if (atualizado.count !== 1) throw new ErroCadastro("Fornecedor alterado. Atualize o cadastro antes de salvar.", 409);
        if (!trocou) return { id: anterior.id, criado: false };
      }
      const fornecedor = await tx.fornecedor.create({ data: { ...data, aplicativoId: usuario.aplicativoId, aplicativoPaiId: body.aplicativo_pai_id, ativo: true }, select: { id: true } });
      return { id: fornecedor.id, criado: true };
    });
    return resposta({ id: resultado.id }, resultado.criado ? 201 : 200);
  } catch (error) { return falha(error); }
}
export async function DELETE(request: Request) {
  try {
    const usuario = await autorizar(request);
    const { id } = z.object({ id: z.guid() }).strict().parse(await request.json().catch(() => null));
    await transacao(async tx => {
      const fornecedor = await tx.fornecedor.findFirst({ where: { id, aplicativoId: usuario.aplicativoId }, select: { id: true, aplicativoPaiId: true, ativo: true } });
      if (!fornecedor) throw new ErroCadastro("Fornecedor não encontrado neste aplicativo.", 404);
      await bloquearRelacaoFornecedor(tx, usuario.aplicativoId, fornecedor.aplicativoPaiId);
      await revalidar(tx, usuario);
      if (!fornecedor.ativo) return;
      const atualizado = await tx.fornecedor.updateMany({ where: { id, aplicativoId: usuario.aplicativoId, aplicativoPaiId: fornecedor.aplicativoPaiId, ativo: true }, data: { ativo: false, encerradoEm: new Date() } });
      if (atualizado.count !== 1) throw new ErroCadastro("Fornecedor alterado. Atualize a página.", 409);
    });
    return resposta({ id, ativo: false });
  } catch (error) { return falha(error); }
}
