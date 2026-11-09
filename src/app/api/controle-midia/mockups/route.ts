import { NextResponse } from "next/server";
import { MockupInvalido, mockupPorId, prepararImagemMockup } from "@/lib/mockups-imagem";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import {
  GoogleStorageServiceError,
  lerGoogleStorageImagemPrivada,
  listarGoogleStorageObjetos,
  uploadToGoogleStorage,
  verificarGoogleStorageBucketPrivado,
} from "@/services/googleStorageService";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

function erro(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

async function executar(
  request: Request,
  operacao: (bucket: string, prefix: string) => Promise<Response>,
) {
  try {
    let autenticado;
    try {
      autenticado = await getUsuarioAutenticado(request);
    } catch {
      return erro("Sessão inválida ou expirada.", 401);
    }
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { ativo: true, aplicativoId: true, podeVisualizarCategoriasMidia: true, podeEditarEstampas: true },
    });
    if (!usuario?.ativo || !(usuario.podeVisualizarCategoriasMidia || (request.method === "GET" && usuario.podeEditarEstampas))) {
      return erro("Sem permissão para acessar os mockups.", 403);
    }
    const bucket = process.env.GOOGLE_CLOUD_MOCKUPS_BUCKET?.trim();
    if (!bucket) return erro("O armazenamento de mockups ainda não foi configurado.", 503);

    return await operacao(bucket, `mockups/${usuario.aplicativoId}/`);
  } catch (error) {
    if (error instanceof MockupInvalido) return erro(error.message, error.status);
    if (error instanceof GoogleStorageServiceError && error.status === 404) {
      return erro("Arquivo ou armazenamento de mockups não encontrado.", 404);
    }
    return erro("Não foi possível acessar o armazenamento de mockups. Tente novamente.", 502);
  }
}

export async function GET(request: Request) {
  return executar(request, async (bucket, prefix) => {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id !== null) {
      if (!mockupPorId(id)) return erro("Mockup inválido.", 400);
      const imagem = await lerGoogleStorageImagemPrivada(bucket, `${prefix}${id}.webp`, "image/webp");
      return new Response(imagem, {
        headers: { ...headers, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" },
      });
    }
    const cursor = params.get("cursor");
    if (cursor && cursor.length > 4096) return erro("Página inválida.", 400);
    const { items = [], nextPageToken } = await listarGoogleStorageObjetos(bucket, prefix, cursor ?? undefined);
    const mockups = items.flatMap(({ name }) => {
      const mockup = name.startsWith(prefix) && name.endsWith(".webp")
        ? mockupPorId(name.slice(prefix.length, -5))
        : null;
      return mockup ? [mockup] : [];
    });
    return NextResponse.json({ mockups, cursor: nextPageToken ?? null }, { headers });
  });
}

export async function POST(request: Request) {
  return executar(request, async (bucket, prefix) => {
    const { id, nome, tipo, imagem } = await prepararImagemMockup(request);
    await verificarGoogleStorageBucketPrivado(bucket);
    try {
      await uploadToGoogleStorage({
        bucket,
        path: `${prefix}${id}.webp`,
        buffer: imagem,
        contentType: "image/webp",
        somenteNovo: true,
      });
    } catch (error) {
      if (!(error instanceof GoogleStorageServiceError) || error.status !== 412) throw error;
      return NextResponse.json({ mockup: { id, nome, tipo } }, { headers });
    }
    return NextResponse.json({ mockup: { id, nome, tipo } }, { status: 201, headers });
  });
}
