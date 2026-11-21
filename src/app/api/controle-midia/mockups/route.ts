import { NextResponse } from "next/server";
import { z } from "zod";
import { MockupInvalido, prepararImagemMockup } from "@/lib/mockups-imagem";
import { MOCKUP_CATEGORIA_MAX, MOCKUP_NOME_MAX, MOCKUP_OBSERVACAO_MAX, type TipoMockup } from "@/lib/mockups";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { getMockupBlobStoreId, MockupBlobStorageError, mockupBlobStorage } from "@/services/mockupBlobStorageService";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const limitePagina = 24;
const entradaMockup = z.object({
  nome: z.string().trim().min(1).max(MOCKUP_NOME_MAX),
  tipo: z.enum(["INDIVIDUAL", "LAYOUT", "INFORMATIVO"]),
  categoria: z.string().trim().max(MOCKUP_CATEGORIA_MAX).default(""),
  observacaoPrompt: z.string().trim().max(MOCKUP_OBSERVACAO_MAX).default(""),
}).strict().refine(({ nome, categoria, observacaoPrompt }) =>
  ![nome, categoria, observacaoPrompt].some((value) => /[\x00-\x1f\x7f]/.test(value)),
"Remova caracteres de controle dos campos.");

type Escopo = { aplicativoId: string };
type EntradaMockup = z.infer<typeof entradaMockup>;

function erro(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

async function autorizar(request: Request): Promise<Escopo | Response> {
  let autenticado;
  try {
    autenticado = await getUsuarioAutenticado(request);
  } catch {
    return erro("Sessão inválida ou expirada.", 401);
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { ativo: true, aplicativoId: true, podeVisualizarCategoriasMidia: true, podeCriarMockups: true },
  });
  const leitura = request.method === "GET";
  if (!usuario?.ativo || !(leitura
    ? usuario.podeVisualizarCategoriasMidia || usuario.podeCriarMockups
    : usuario.podeVisualizarCategoriasMidia || usuario.podeCriarMockups)) {
    return erro("Sem permissão para acessar os mockups.", 403);
  }
  if (!getMockupBlobStoreId()) return erro("O armazenamento de mockups ainda não foi configurado na Vercel.", 503);
  return { aplicativoId: usuario.aplicativoId };
}

function cursors(cursor: string | null): { createdAt: Date; id: string } | null {
  if (!cursor || cursor.length > 1200) return null;
  try {
    const decodificado = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decodificado).toString("base64url") !== cursor) return null;
    const dados: unknown = JSON.parse(decodificado);
    if (!dados || typeof dados !== "object") return null;
    const { createdAt, id } = dados as Record<string, unknown>;
    if (typeof createdAt !== "string" || typeof id !== "string" || id.length > 608) return null;
    const data = new Date(createdAt);
    return Number.isNaN(data.getTime()) ? null : { createdAt: data, id };
  } catch {
    return null;
  }
}

function serializarCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function validarEntrada(valor: unknown): EntradaMockup | Response {
  const resultado = entradaMockup.safeParse(valor);
  return resultado.success ? resultado.data : erro("Revise o nome, o tipo, a categoria e a observação do prompt.", 400);
}

function caminhoImagem(aplicativoId: string, id: string, tipo: TipoMockup) {
  return tipo === "INFORMATIVO"
    ? `mockups/${aplicativoId}/informativos/${id}.webp`
    : `mockups/${aplicativoId}/${id}.webp`;
}

async function tratarErro(error: unknown) {
  if (error instanceof MockupInvalido) return erro(error.message, error.status);
  if (error instanceof MockupBlobStorageError) {
    if (error.status === 404) return erro("Arquivo de mockup não encontrado.", 404);
    if (error.status === 503) return erro(error.message, 503);
    if (error.status === 412) return erro("Já existe um mockup com esses dados.", 409);
    if (error.status === 413) return erro(error.message, 413);
    if (error.status === 429) return erro(error.message, 429);
  }
  return erro("Não foi possível acessar ou salvar o mockup. Tente novamente.", 502);
}

export async function GET(request: Request) {
  try {
    const escopo = await autorizar(request);
    if (escopo instanceof Response) return escopo;
    const params = new URL(request.url).searchParams;
    const detalhesId = params.get("detalhesId");
    if (detalhesId !== null) {
      if (!detalhesId || detalhesId.length > 608) return erro("Mockup inválido.", 400);
      const mockup = await prisma.mockupCatalogo.findUnique({
        where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id: detalhesId } },
        select: { id: true, nome: true, tipo: true, categoria: true, observacaoPrompt: true, ativo: true },
      });
      if (!mockup?.ativo) return erro("Mockup não encontrado.", 404);
      return NextResponse.json({ mockup: {
        id: mockup.id, nome: mockup.nome, tipo: mockup.tipo,
        categoria: mockup.categoria, observacaoPrompt: mockup.observacaoPrompt,
      } }, { headers });
    }
    const id = params.get("id");
    if (id !== null) {
      if (!id || id.length > 608) return erro("Mockup inválido.", 400);
      const item = await prisma.mockupCatalogo.findUnique({
        where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id } },
        select: { storagePath: true, tipo: true, ativo: true },
      });
      if (!item?.ativo) return erro("Mockup não encontrado.", 404);
      const imagem = await mockupBlobStorage.ler(item.storagePath, "image/webp");
      return new Response(imagem, {
        headers: { ...headers, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" },
      });
    }

    const cursorParam = params.get("cursor");
    const cursor = cursorParam ? cursors(cursorParam) : null;
    if (cursorParam && !cursor) return erro("Página inválida.", 400);
    const incluirInformativos = params.get("incluirInformativos") === "1";
    const condicoes = [
      { aplicativoId: escopo.aplicativoId, ativo: true },
      ...(incluirInformativos ? [] : [{ tipo: { in: ["INDIVIDUAL", "LAYOUT"] } }]),
      ...(cursor ? [{ OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ] }] : []),
    ];
    const registros = await prisma.mockupCatalogo.findMany({
      where: { AND: condicoes },
      select: { id: true, nome: true, tipo: true, categoria: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limitePagina + 1,
    });
    const temMais = registros.length > limitePagina;
    const mockups = registros.slice(0, limitePagina).map((item) => ({
      id: item.id, nome: item.nome, tipo: item.tipo, categoria: item.categoria,
    }));
    const ultimo = registros[Math.min(limitePagina, registros.length) - 1];
    return NextResponse.json({
      mockups,
      cursor: temMais && ultimo ? serializarCursor(ultimo.createdAt, ultimo.id) : null,
    }, { headers });
  } catch (error) {
    return tratarErro(error);
  }
}

export async function POST(request: Request) {
  try {
    const escopo = await autorizar(request);
    if (escopo instanceof Response) return escopo;
    const dados = await prepararImagemMockup(request);
    const storagePath = caminhoImagem(escopo.aplicativoId, dados.id, dados.tipo);
    await mockupBlobStorage.enviar({ path: storagePath, buffer: dados.imagem, contentType: "image/webp", somenteNovo: true });
    try {
      const item = await prisma.mockupCatalogo.create({
        data: {
          aplicativoId: escopo.aplicativoId,
          id: dados.id,
          nome: dados.nome,
          tipo: dados.tipo,
          categoria: dados.categoria,
          observacaoPrompt: dados.observacaoPrompt,
          storagePath,
        },
        select: { id: true, nome: true, tipo: true, categoria: true, observacaoPrompt: true },
      });
      return NextResponse.json({ mockup: item }, { status: 201, headers });
    } catch (error) {
      await mockupBlobStorage.remover(storagePath).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof MockupInvalido) return erro(error.message, error.status);
    if (error instanceof MockupBlobStorageError && error.status === 412) return erro("Este arquivo já está cadastrado.", 409);
    return tratarErro(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const escopo = await autorizar(request);
    if (escopo instanceof Response) return escopo;
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (!id || id.length > 608) return erro("Mockup inválido.", 400);
    const anterior = await prisma.mockupCatalogo.findUnique({
      where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id } },
      select: { storagePath: true, ativo: true, tipo: true },
    });
    if (!anterior?.ativo) return erro("Mockup não encontrado.", 404);

    let dados: EntradaMockup;
    let imagem: Buffer | null = null;
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const recebido: unknown = await request.json().catch(() => null);
      const validado = validarEntrada(recebido);
      if (validado instanceof Response) return validado;
      dados = validado;
    } else {
      const preparado = await prepararImagemMockup(request);
      dados = {
        nome: preparado.nome,
        tipo: preparado.tipo,
        categoria: preparado.categoria,
        observacaoPrompt: preparado.observacaoPrompt,
      };
      imagem = preparado.imagem;
    }
    if (dados.tipo !== anterior.tipo) return erro("O tipo é definido no cadastro inicial do mockup e não pode ser alterado depois.", 422);
    if (imagem) {
      await mockupBlobStorage.enviar({ path: anterior.storagePath, buffer: imagem, contentType: "image/webp" });
    }
    const item = await prisma.mockupCatalogo.update({
      where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id } },
      data: dados,
      select: { id: true, nome: true, tipo: true, categoria: true, observacaoPrompt: true },
    });
    return NextResponse.json({ mockup: item }, { headers });
  } catch (error) {
    return tratarErro(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const escopo = await autorizar(request);
    if (escopo instanceof Response) return escopo;
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id.length > 608) return erro("Mockup inválido.", 400);
    const item = await prisma.mockupCatalogo.findUnique({
      where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id } },
      select: { storagePath: true, ativo: true },
    });
    if (!item?.ativo) return erro("Mockup não encontrado.", 404);
    const usosAtivos = await prisma.$queryRaw<Array<{ existe: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM public.fila_mockups AS fila
        CROSS JOIN LATERAL jsonb_array_elements(fila.trabalhos) AS trabalho
        WHERE fila.aplicativo_id = ${escopo.aplicativoId}::uuid
          AND fila.status IN ('PENDING', 'PROCESSING')
          AND trabalho->>'mockupId' = ${id}
      ) AS existe
    `;
    if (usosAtivos[0]?.existe) return erro("Este mockup está sendo usado por um lote pendente ou em processamento.", 409);
    await mockupBlobStorage.remover(item.storagePath);
    await prisma.mockupCatalogo.delete({ where: { aplicativoId_id: { aplicativoId: escopo.aplicativoId, id } } });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    return tratarErro(error);
  }
}
