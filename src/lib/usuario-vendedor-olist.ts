import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const idOlist = z.number().int().positive().max(2147483647);
export const vendedorOlistEntradaSchema = z.array(z.object({
  aplicativoId: z.guid(), vendedorOlistId: idOlist,
}).strict()).max(1000).refine((itens) => new Set(itens.map((item) => item.aplicativoId)).size === itens.length,
  "Informe apenas um vendedor por aplicativo.");
export type EntradaVendedorOlist = z.infer<typeof vendedorOlistEntradaSchema>[number];

export class ErroVinculoVendedorOlist extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** O vínculo identifica o vendedor; não concede permissão sobre a conta. */
export async function obterVendedorDoUsuario(usuarioId: string, aplicativoId: string): Promise<number | null> {
  const vinculo = await prisma.usuarioVendedorOlist.findFirst({
    where: { usuarioId, aplicativoId, usuario: { OR: [
      { aplicativoId }, { aplicativo: { filiais: { some: { id: aplicativoId } } } },
    ] } },
    select: { vendedorOlistId: true },
  });
  return vinculo?.vendedorOlistId ?? null;
}

export async function listarAplicativosElegiveis(aplicativoId: string) {
  const aplicativos = await prisma.aplicativo.findMany({
    where: { OR: [{ id: aplicativoId }, { aplicativoPaiId: aplicativoId }] },
    select: { id: true, nome: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 1001,
  });
  if (aplicativos.length > 1000) throw new ErroVinculoVendedorOlist("O grupo excede o limite de aplicativos do cadastro.");
  return aplicativos;
}

async function bloquearUsuario(tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string) {
  const [usuario] = await tx.$queryRaw<Array<{ vinculosOlistVersao: number }>>`
    SELECT vinculos_olist_versao AS "vinculosOlistVersao" FROM usuario
    WHERE id=${usuarioId}::uuid AND aplicativo_id=${aplicativoId}::uuid FOR UPDATE`;
  if (!usuario) throw new ErroVinculoVendedorOlist("Usuário não encontrado neste aplicativo.", 404);
  return usuario;
}

async function versaoAtual(tx: Prisma.TransactionClient, usuarioId: string) {
  const usuario = await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { vinculosOlistVersao: true } });
  return usuario.vinculosOlistVersao;
}

// Durante a publicação gradual, escritores antigos ainda atualizam o escalar.
// A ponte SQL é unidirecional e mantém a linha própria. Desligar antes da contração.
function compatibilidadeLegada() { return process.env.OLIST_VENDEDORES_COMPAT_LEGADO !== "false"; }

async function gravarProprio(tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string, vendedorOlistId: number | null) {
  if (compatibilidadeLegada()) {
    await tx.$executeRaw`UPDATE usuario SET vendedor_olist_id=${vendedorOlistId} WHERE id=${usuarioId}::uuid AND aplicativo_id=${aplicativoId}::uuid`;
  } else if (vendedorOlistId === null) {
    await tx.usuarioVendedorOlist.deleteMany({ where: { usuarioId, aplicativoId } });
  } else {
    await tx.usuarioVendedorOlist.upsert({
      where: { usuarioId_aplicativoId: { usuarioId, aplicativoId } },
      create: { usuarioId, aplicativoId, vendedorOlistId }, update: { vendedorOlistId },
    });
  }
}

export async function substituirVendedoresOlist(
  tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string,
  vinculos: EntradaVendedorOlist[], versaoEsperada: number,
): Promise<number> {
  const parsed = vendedorOlistEntradaSchema.safeParse(vinculos);
  if (!parsed.success || !Number.isInteger(versaoEsperada) || versaoEsperada < 0) {
    throw new ErroVinculoVendedorOlist("Informe vendedores e versão válidos.");
  }
  const usuario = await bloquearUsuario(tx, usuarioId, aplicativoId);
  if (usuario.vinculosOlistVersao !== versaoEsperada) {
    throw new ErroVinculoVendedorOlist("Os vínculos foram alterados. Recarregue o usuário antes de salvar.", 409);
  }
  // Uma consulta limitada valida e estabiliza todo o grupo antes da primeira escrita.
  const ids = parsed.data.map((item) => item.aplicativoId).sort();
  if (ids.length) {
    const elegiveis = await tx.$queryRaw<Array<{ id: string }>>(sqlAplicativosElegiveis(ids, aplicativoId));
    if (elegiveis.length !== ids.length) throw new ErroVinculoVendedorOlist("Selecione somente o aplicativo próprio ou seus filhos diretos.");
  }
  const proprio = parsed.data.find((item) => item.aplicativoId === aplicativoId);
  await gravarProprio(tx, usuarioId, aplicativoId, proprio?.vendedorOlistId ?? null);
  const filhos = parsed.data.filter((item) => item.aplicativoId !== aplicativoId);
  await tx.usuarioVendedorOlist.deleteMany({ where: {
    usuarioId, aplicativoId: { not: aplicativoId, notIn: filhos.map((item) => item.aplicativoId) },
  } });
  if (filhos.length) {
    // JSON validado é parâmetro SQL. Uma ida ao banco evita até 1.000 upserts pela rede.
    const dados = JSON.stringify(filhos);
    await tx.$executeRaw`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id)
      SELECT ${usuarioId}::uuid,x."aplicativoId",x."vendedorOlistId"
      FROM jsonb_to_recordset(${dados}::jsonb) AS x("aplicativoId" uuid,"vendedorOlistId" integer)
      ORDER BY x."aplicativoId"
      ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id`;
  }
  return versaoAtual(tx, usuarioId);
}

function sqlAplicativosElegiveis(ids: string[], aplicativoId: string) {
  return Prisma.sql`SELECT id FROM aplicativo
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      AND (id=${aplicativoId}::uuid OR aplicativo_pai_id=${aplicativoId}::uuid)
    ORDER BY id FOR SHARE`;
}

export async function alterarVendedorOlistLegado(
  tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string, vendedorOlistId: number | null,
): Promise<number> {
  if (vendedorOlistId !== null && !idOlist.safeParse(vendedorOlistId).success) {
    throw new ErroVinculoVendedorOlist("Informe um ID de vendedor válido.");
  }
  await bloquearUsuario(tx, usuarioId, aplicativoId);
  await gravarProprio(tx, usuarioId, aplicativoId, vendedorOlistId);
  return versaoAtual(tx, usuarioId);
}
