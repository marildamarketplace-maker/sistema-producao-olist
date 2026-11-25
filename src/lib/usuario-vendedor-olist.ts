import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bloquearRelacaoFornecedor } from "@/lib/fornecedor-relacao";

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
export async function obterVendedorDoUsuario(usuarioId: string, aplicativoId: string,
  db: Prisma.TransactionClient = prisma): Promise<number | null> {
  const vinculo = await db.usuarioVendedorOlist.findFirst({
    where: { usuarioId, aplicativoId, ...vinculoVendedorVigenteWhere(aplicativoId) },
    select: { vendedorOlistId: true },
  });
  return vinculo?.vendedorOlistId ?? null;
}

/** Os triggers preservam origem/grupo dos vínculos ativos; a relação é conferida em toda leitura. */
export function vinculoVendedorVigenteWhere(aplicativoId: string): Prisma.UsuarioVendedorOlistWhereInput {
  return { revogadoEm: null, OR: [
    { origemAplicativoId: null, fornecedorMatrizId: null, usuario: { OR: [
      { aplicativoId }, { aplicativo: { filiais: { some: { id: aplicativoId } } } },
    ] } },
    { origemAplicativoId: { not: null }, fornecedorMatrizId: { not: null }, confirmadoEm: { not: null },
      usuario: { ativo: true, aplicativo: { fornecedores: { some: { ativo: true,
        aplicativoPai: { aplicativoPaiId: null, OR: [{ id: aplicativoId }, { filiais: { some: { id: aplicativoId } } }] },
      } } } } },
  ] };
}

export type VinculoVendedorUsuario = {
  vendedorOlistId: number; revisao: number;
  origemAplicativoId: string | null; fornecedorMatrizId: string | null;
};

export async function obterVinculoVendedorDoUsuario(usuarioId: string, aplicativoId: string,
  db: Prisma.TransactionClient = prisma): Promise<VinculoVendedorUsuario | null> {
  return db.usuarioVendedorOlist.findFirst({
    where: { usuarioId, aplicativoId, ...vinculoVendedorVigenteWhere(aplicativoId) },
    select: { vendedorOlistId: true, revisao: true, origemAplicativoId: true, fornecedorMatrizId: true },
  });
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

// A configuração é uma preferência da publicação gradual, não prova de que a
// coluna/ponte ainda existem. Não tentar UPDATE e capturar 42703: isso abortaria
// a transação PostgreSQL, impedindo a gravação normalizada dos filhos.
async function compatibilidadeLegada(tx: Prisma.TransactionClient): Promise<boolean> {
  if (process.env.OLIST_VENDEDORES_COMPAT_LEGADO === "false") return false;
  const [estado] = await tx.$queryRaw<Array<{ disponivel: boolean }>>`SELECT
    EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.usuario'::regclass AND attname='vendedor_olist_id' AND NOT attisdropped)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid='public.usuario'::regclass AND tgname='usuario_vendedor_olist_ponte_update'
        AND NOT tgisinternal AND tgenabled IN ('O','A')) AS disponivel`;
  if (typeof estado?.disponivel !== "boolean") {
    throw new ErroVinculoVendedorOlist("Não foi possível verificar a configuração dos vínculos. Tente novamente.", 500);
  }
  return estado.disponivel;
}

async function gravarProprio(tx: Prisma.TransactionClient, usuarioId: string, aplicativoId: string, vendedorOlistId: number | null) {
  // bloquearUsuario já mantém o lock do usuário: a contração não pode remover
  // a coluna entre esta verificação e o UPDATE da ponte.
  if (await compatibilidadeLegada(tx)) {
    await tx.$executeRaw`UPDATE usuario SET vendedor_olist_id=${vendedorOlistId} WHERE id=${usuarioId}::uuid AND aplicativo_id=${aplicativoId}::uuid`;
  } else if (vendedorOlistId === null) {
    await tx.usuarioVendedorOlist.deleteMany({ where: { usuarioId, aplicativoId,
      origemAplicativoId: null, fornecedorMatrizId: null } });
  } else {
    await tx.usuarioVendedorOlist.upsert({
      where: { usuarioId_aplicativoId: { usuarioId, aplicativoId } },
      create: { usuarioId, aplicativoId, vendedorOlistId }, update: { vendedorOlistId,
        origemAplicativoId: null, fornecedorMatrizId: null, confirmadoEm: null, confirmadoPorId: null,
        revogadoEm: null, motivoRevogacao: null },
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
    usuarioId, origemAplicativoId: null, fornecedorMatrizId: null,
    aplicativo: { aplicativoPaiId: aplicativoId },
    aplicativoId: { not: aplicativoId, notIn: filhos.map((item) => item.aplicativoId) },
  } });
  if (filhos.length) {
    // JSON validado é parâmetro SQL. Uma ida ao banco evita até 1.000 upserts pela rede.
    const dados = JSON.stringify(filhos);
    await tx.$executeRaw`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id)
      SELECT ${usuarioId}::uuid,x."aplicativoId",x."vendedorOlistId"
      FROM jsonb_to_recordset(${dados}::jsonb) AS x("aplicativoId" uuid,"vendedorOlistId" integer)
      ORDER BY x."aplicativoId"
      ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id,
        origem_aplicativo_id=NULL,fornecedor_matriz_id=NULL,confirmado_em=NULL,confirmado_por_id=NULL,
        revogado_em=NULL,motivo_revogacao=NULL`;
  }
  return versaoAtual(tx, usuarioId);
}

/** A coleção representa somente o grupo do fornecedor; omitidos são revogados, nunca apagados. */
export async function substituirVendedoresExternosOlist(tx: Prisma.TransactionClient, usuarioId: string,
  clienteId: string, matrizId: string, vinculos: EntradaVendedorOlist[], versaoEsperada: number,
  operadorId: string): Promise<number> {
  const parsed = vendedorOlistEntradaSchema.safeParse(vinculos);
  if (!parsed.success || !Number.isInteger(versaoEsperada) || versaoEsperada < 0) {
    throw new ErroVinculoVendedorOlist("Informe vendedores e versão válidos.");
  }
  await bloquearRelacaoFornecedor(tx, clienteId, matrizId);
  const usuario = await bloquearUsuario(tx, usuarioId, clienteId);
  if (usuario.vinculosOlistVersao !== versaoEsperada) {
    throw new ErroVinculoVendedorOlist("Os vínculos foram alterados. Recarregue antes de salvar.", 409);
  }
  const relacao = await tx.fornecedor.findFirst({ where: { aplicativoId: clienteId, aplicativoPaiId: matrizId,
    ativo: true, aplicativoPai: { aplicativoPaiId: null } }, select: { id: true } });
  if (!relacao || clienteId === matrizId) throw new ErroVinculoVendedorOlist("Relação de fornecimento não está ativa.", 403);
  const ids = parsed.data.map(v => v.aplicativoId).sort();
  if (ids.length && (await tx.$queryRaw<Array<{ id: string }>>(sqlAplicativosElegiveis(ids, matrizId, { clienteId, usuarioId }))).length !== ids.length) {
    throw new ErroVinculoVendedorOlist("Selecione somente a matriz fornecedora ou suas filiais diretas, sem sobrepor vínculos internos do cliente.");
  }
  await tx.usuarioVendedorOlist.updateMany({ where: {
    usuarioId, origemAplicativoId: clienteId, fornecedorMatrizId: matrizId, revogadoEm: null,
    aplicativoId: { notIn: ids },
  }, data: { revogadoEm: new Date(), motivoRevogacao: "REMOVIDO_PELO_FORNECEDOR" } });
  if (parsed.data.length) {
    const dados = JSON.stringify(parsed.data);
    await tx.$executeRaw`INSERT INTO usuario_vendedor_olist(usuario_id,aplicativo_id,vendedor_olist_id,
      origem_aplicativo_id,fornecedor_matriz_id,confirmado_em,confirmado_por_id)
      SELECT ${usuarioId}::uuid,x."aplicativoId",x."vendedorOlistId",${clienteId}::uuid,${matrizId}::uuid,
        clock_timestamp(),${operadorId}::uuid
      FROM jsonb_to_recordset(${dados}::jsonb) AS x("aplicativoId" uuid,"vendedorOlistId" integer)
      ORDER BY x."aplicativoId"
      ON CONFLICT(usuario_id,aplicativo_id) DO UPDATE SET vendedor_olist_id=EXCLUDED.vendedor_olist_id,
        origem_aplicativo_id=EXCLUDED.origem_aplicativo_id,fornecedor_matriz_id=EXCLUDED.fornecedor_matriz_id,
        confirmado_em=EXCLUDED.confirmado_em,confirmado_por_id=EXCLUDED.confirmado_por_id,
        revogado_em=NULL,motivo_revogacao=NULL
      WHERE usuario_vendedor_olist.revogado_em IS NOT NULL
        OR usuario_vendedor_olist.vendedor_olist_id IS DISTINCT FROM EXCLUDED.vendedor_olist_id
        OR usuario_vendedor_olist.origem_aplicativo_id IS DISTINCT FROM EXCLUDED.origem_aplicativo_id
        OR usuario_vendedor_olist.fornecedor_matriz_id IS DISTINCT FROM EXCLUDED.fornecedor_matriz_id`;
  }
  return versaoAtual(tx, usuarioId);
}

/** A gestão nativa conserva a conta do cliente e seus filhos, mesmo sem vendedor cadastrado. */
export function aplicativosExternosElegiveisWhere(matrizId: string, clienteId: string): Prisma.AplicativoWhereInput {
  return { AND: [
    { OR: [{ id: matrizId }, { aplicativoPaiId: matrizId }] },
    { id: { not: clienteId } },
    { OR: [{ aplicativoPaiId: null }, { aplicativoPaiId: { not: clienteId } }] },
  ] };
}

function sqlAplicativosElegiveis(ids: string[], aplicativoId: string,
  externo?: { clienteId: string; usuarioId: string }) {
  return Prisma.sql`SELECT id FROM aplicativo
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      AND (id=${aplicativoId}::uuid OR aplicativo_pai_id=${aplicativoId}::uuid)
      ${externo ? Prisma.sql`AND id<>${externo.clienteId}::uuid AND aplicativo_pai_id IS DISTINCT FROM ${externo.clienteId}::uuid
        AND NOT EXISTS(SELECT 1 FROM usuario_vendedor_olist v WHERE v.usuario_id=${externo.usuarioId}::uuid
          AND v.aplicativo_id=aplicativo.id AND v.origem_aplicativo_id IS NULL AND v.fornecedor_matriz_id IS NULL)` : Prisma.empty}
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
